import { AuditLogEntry } from '../types/worker';

export function logAuditEntry(entry: AuditLogEntry) {
  // Output structured JSON log for Cloudflare Observability & Logpush
  const logData = {
    level: entry.status >= 500 ? 'ERROR' : entry.status >= 400 ? 'WARN' : 'INFO',
    type: 'chatbot_audit',
    ...entry,
  };
  
  if (entry.status >= 500) {
    console.error(JSON.stringify(logData));
  } else if (entry.status >= 400) {
    console.warn(JSON.stringify(logData));
  } else {
    console.log(JSON.stringify(logData));
  }
}
