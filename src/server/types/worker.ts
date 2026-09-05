export interface Env {
  GEMINI_API_KEY?: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  DB?: D1Database;
}

export interface ChatRequestPayload {
  message?: string;
  context?: string;
  stream?: boolean;
  sessionId?: string;
  inputMode?: 'text' | 'voice' | 'suggestion';
  promptIndex?: number;
}

export interface ChatResponsePayload {
  response: string;
  modelUsed?: string;
  latencyMs?: number;
  error?: string;
  details?: string;
}

export interface AuditLogEntry {
  timestamp: string;
  sessionId?: string;
  clientIp?: string;
  origin?: string;
  endpoint: string;
  inputMode: 'text' | 'voice' | 'suggestion' | 'unknown';
  promptIndex?: number;
  promptText?: string;
  modelUsed?: string;
  status: number;
  latencyMs?: number;
  error?: string;
}
