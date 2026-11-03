import { Env } from '../types/worker';
import { CONFIG } from '../config';
import { jsonResponse } from '../middleware/errorHandler';

export function handleHealth(request: Request, env: Env): Response {
  const hasKey = Boolean(env.GEMINI_API_KEY?.trim());

  return jsonResponse(
    {
      status: 'ok',
      service: 'portfolio-emulator-chat',
      timestamp: new Date().toISOString(),
      models: {
        primary: CONFIG.MODELS.PRIMARY,
        fallback: CONFIG.MODELS.FALLBACK,
        live: CONFIG.MODELS.LIVE,
      },
      configured: hasKey,
    },
    200,
    request,
    {},
    env
  );
}
