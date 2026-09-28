import type { Request, Response } from 'express';
import type { PurgeApplyPayload, PurgeApplyResultType, StreamEvent } from '@reports/shared';
import { scanForLeaks } from '@pipe/protocol';

import { getSubscriptionConfig } from './config-props';
import { applyDictionaryWithCount } from './dictionary';

function sender(res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  return (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };
}

function withSync(res: Response, label: string, run: () => unknown) {
  const sendEvent = sender(res);

  try {
    sendEvent({ type: 'message', data: run() });
  } catch (error) {
    console.error(`${label} error:`, error);
    sendEvent({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' });
  } finally {
    res.end();
  }
}

// reports' own equivalent of bridge Purge's Apply tab — same dictionary
// machinery, run server-side since reports' client has no @pipe/protocol
// dependency. The leak scan only makes sense on an anonymization result
// (toRemote); a de-anonymized (toLocal) result is real data by design.
export function handlePurgeApply(req: Request, res: Response) {
  const { text, direction } = req.body as PurgeApplyPayload;

  withSync(res, 'Apply purge dictionary', (): PurgeApplyResultType => {
    const { dictionary } = getSubscriptionConfig();
    const { result, count } = applyDictionaryWithCount(text ?? '', dictionary, direction);
    const leaks = direction === 'toRemote' ? scanForLeaks([{ source: 'результат', content: result }]) : [];

    return { result, count, leaks };
  });
}
