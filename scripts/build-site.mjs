import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { projectRoot, publicEntries } from './site-files.mjs';

const destination = resolve(projectRoot, 'dist');
const configuredWorker = process.env.CHATBOT_WORKER_URL;
let workerUrl;

if (configuredWorker) {
  const url = new URL(configuredWorker);
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('CHATBOT_WORKER_URL must be an HTTPS origin (or HTTP localhost), without credentials, a path, query, or fragment.');
  }
  workerUrl = url.origin;
}

async function verifyPublicEntry(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Public assets cannot be symbolic links: ${path}`);
  if (info.isDirectory()) {
    for (const name of await readdir(path)) {
      if (name.startsWith('.')) continue;
      await verifyPublicEntry(resolve(path, name));
    }
  } else if (!info.isFile()) {
    throw new Error(`Public assets must be regular files: ${path}`);
  }
}

// Validate before replacing the previous build, including accidental links to
// private files outside an otherwise public asset directory.
for (const entry of publicEntries) await verifyPublicEntry(resolve(projectRoot, entry));

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const entry of publicEntries) {
  await cp(resolve(projectRoot, entry), resolve(destination, entry), {
    recursive: true,
    dereference: false,
    filter: (source) => !basename(source).startsWith('.'),
  });
}

if (workerUrl) {
  const mainPath = resolve(destination, 'main.html');
  const html = await readFile(mainPath, 'utf8');
  const declaration = /const CHATBOT_WORKER_URL = ['"][^'"\r\n]+['"];?/g;
  if ([...html.matchAll(declaration)].length !== 1) {
    throw new Error('Expected exactly one CHATBOT_WORKER_URL declaration in main.html.');
  }
  // Escape HTML delimiters so the configured origin cannot end an inline script.
  const literal = JSON.stringify(workerUrl).replaceAll('<', '\\u003c');
  await writeFile(mainPath, html.replace(declaration, () => `const CHATBOT_WORKER_URL = ${literal};`));
}

await writeFile(resolve(destination, '.nojekyll'), '');
console.log(`Built ${publicEntries.length} public entries in dist/${workerUrl ? ` (chat API: ${workerUrl})` : ''}.`);
