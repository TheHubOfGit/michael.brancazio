import { Env } from '../types/worker';
import { CONFIG } from '../config';
import { jsonResponse } from '../middleware/errorHandler';

export function handleHealth(request: Request, env: Env): Response {
  const hasKey = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.length > 0);

  return jsonResponse(
    {
      status: 'ok',
      service: 'michael.brancazio-ai-worker',
      timestamp: new Date().toISOString(),
      models: {
        primary: CONFIG.MODELS.PRIMARY,
        fallback: CONFIG.MODELS.FALLBACK,
      },
      configured: hasKey,
    },
    200,
    request
  );
}
