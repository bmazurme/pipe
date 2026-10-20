import type { Response } from 'express';
import type { StreamEvent } from '@reports/shared';

export function streamSender(res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  return (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };
}

export async function withStream(res: Response, label: string, run: () => Promise<unknown>) {
  const sendEvent = streamSender(res);

  try {
    sendEvent({ type: 'message', data: await run() });
  } catch (error) {
    console.error(`${label} error:`, error);
    sendEvent({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' });
  } finally {
    res.end();
  }
}
