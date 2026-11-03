import { Env } from '../types/worker';
import { jsonResponse, errorResponse } from '../middleware/errorHandler';
import { checkRateLimit, getRateLimitHeaders } from '../middleware/rateLimit';

const TITLE_BYTES = 65_536;
const TIMEOUT_MS = 6_000;

/** Rejects non-web schemes and hosts that point at private or local networks. */
function isPublicWebUrl(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (host.includes(':')) return false; // IPv6 literals
  return true;
}

/** Applies X-Frame-Options and CSP frame-ancestors the way a browser would for our origin. */
export function embedVerdict(headers: Headers, ourOrigin: string): { embeddable: boolean; reason?: string } {
  const xfo = headers.get('x-frame-options')?.trim().toLowerCase();
  if (xfo && (xfo === 'deny' || xfo === 'sameorigin' || xfo.startsWith('allow-from'))) return { embeddable: false, reason: `x-frame-options: ${xfo}` };
  const csp = headers.get('content-security-policy') || '';
  const directive = csp.split(/[;,]/).map((d) => d.trim()).find((d) => d.toLowerCase().startsWith('frame-ancestors'));
  if (!directive) return { embeddable: true };
  const sources = directive.split(/\s+/).slice(1).map((s) => s.toLowerCase());
  const origin = new URL(ourOrigin);
  const allowed = sources.some((src) => {
    if (src === '*') return true;
    if (src === "'none'" || src === "'self'") return false;
    if (src === 'https:' || src === `${origin.protocol}`) return true;
    const m = /^(?:(https?):\/\/)?(\*\.)?([^/:]+)/.exec(src);
    if (!m) return false;
    if (m[1] && `${m[1]}:` !== origin.protocol) return false;
    return m[2] ? origin.hostname.endsWith(`.${m[3]}`) : origin.hostname === m[3];
  });
  return allowed ? { embeddable: true } : { embeddable: false, reason: 'content-security-policy: frame-ancestors' };
}

async function readTitle(body: ReadableStream<Uint8Array> | null): Promise<string | undefined> {
  if (!body) return undefined;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  try {
    while (html.length < TITLE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  return m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim().slice(0, 140) || undefined;
}

/** GET /api/frame-check?url=… — tells the Safari window whether a page can load inside it. */
export async function handleFrameCheck(request: Request, env: Env): Promise<Response> {
  const rate = checkRateLimit(request);
  const rateHeaders = getRateLimitHeaders(rate);
  if (!rate.allowed) return errorResponse('Too many requests', 429, request, undefined, env, rateHeaders);
  let target: URL;
  try {
    const raw = new URL(request.url).searchParams.get('url') || '';
    if (raw.length > 2048) throw new Error();
    target = new URL(raw);
  } catch {
    return errorResponse('A valid url parameter is required', 400, request, undefined, env, rateHeaders);
  }
  if (!isPublicWebUrl(target)) return errorResponse('Only public http(s) URLs can be checked', 400, request, undefined, env, rateHeaders);

  try {
    const response = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const verdict = embedVerdict(response.headers, new URL(request.url).origin);
    const isHtml = (response.headers.get('content-type') || '').includes('html');
    const title = isHtml ? await readTitle(response.body) : (await response.body?.cancel().catch(() => undefined), undefined);
    return jsonResponse({ url: response.url || target.toString(), status: response.status, ...verdict, title }, 200, request, { ...rateHeaders, 'Cache-Control': 'public, max-age=300' }, env);
  } catch {
    // Unknown is not "blocked": the browser will still try to load it.
    return jsonResponse({ url: target.toString(), status: 0, embeddable: null, reason: 'unreachable' }, 200, request, rateHeaders, env);
  }
}
