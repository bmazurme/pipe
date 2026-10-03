import pino from 'pino';

// Runs under systemd (journald captures stdout as-is) and Swarm (json-file
// driver, see bridge-stack.yml) — both prefer structured JSON lines over
// free-text console.log, so logs can actually be filtered/queried by
// jobId/chatId instead of grepped.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});

export function jobLogger(jobId: number) {
  return logger.child({ jobId });
}

export function chatLogger(messageId: number) {
  return logger.child({ chatId: messageId });
}
