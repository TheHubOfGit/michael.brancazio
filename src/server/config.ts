export const CONFIG = {
  // Preserved models as required
  MODELS: {
    PRIMARY: 'gemini-3.5-flash-lite',
    FALLBACK: 'gemini-2.5-flash-lite',
  },
  GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models',
  GEMINI_LIVE_WS_BASE: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
  ALLOWED_ORIGINS: [
    'https://thehubofgit.github.io',
    'https://michael.brancazio',
    'https://michaelbrancazio.pages.dev',
    'https://michaelbrancazio-resume.pages.dev',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8787',
    'http://127.0.0.1:8787'
  ],
  RATE_LIMIT: {
    MAX_REQUESTS_PER_MINUTE: 40,
    BURST_CAPACITY: 10
  }
} as const;
