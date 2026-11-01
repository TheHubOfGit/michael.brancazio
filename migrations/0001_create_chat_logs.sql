-- Safe to apply to an existing installation that already has this table.
CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  session_id TEXT,
  client_ip TEXT,
  input_mode TEXT NOT NULL,
  prompt_index INTEGER,
  prompt_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  model_used TEXT,
  latency_ms INTEGER,
  status INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_timestamp ON chat_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_chat_logs_session_id ON chat_logs(session_id);
