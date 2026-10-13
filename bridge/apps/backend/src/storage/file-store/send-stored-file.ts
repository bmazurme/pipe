import type { Response } from 'express';

import type { FileStore } from './file-store';
import { FileMissingError } from './file-store';

export type SendDone = (error?: Error) => void;

export type SendMode =
  // Content-Disposition: attachment — the Storage/Worker downloads.
  | { kind: 'download'; filename: string }
  // Rendered where it is (chat attachments); the caller has set the headers it wants.
  | { kind: 'inline' };

// Sends one stored file to the client and reports the outcome exactly once through `done` — the contract of
// res.download()'s callback that the controllers already rely on (delete after a successful download, a 404 for
// a file that is gone). A plain local file still goes through Express's own download/sendFile (ranges, ETag,
// the existing behaviour); a remote one is streamed.
export function sendStoredFile(
  store: FileStore,
  res: Response,
  key: string,
  mode: SendMode,
  done: SendDone,
): void {
  const local = store.localPath(key);

  if (local) {
    if (mode.kind === 'download') res.download(local, mode.filename, done);
    else res.sendFile(local, done);

    return;
  }

  void streamRemote(store, res, key, mode, done);
}

async function streamRemote(
  store: FileStore,
  res: Response,
  key: string,
  mode: SendMode,
  done: SendDone,
): Promise<void> {
  let finished = false;
  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    done(error);
  };

  try {
    const meta = await store.stat(key);

    if (!meta) throw new FileMissingError(key);

    const stream = await store.openRead(key);

    if (mode.kind === 'download') res.attachment(mode.filename);

    res.setHeader('Content-Length', String(meta.size));

    stream.on('error', (error) => {
      // Nothing valid to send after the first bytes: end the connection.
      res.destroy(error);
      finish(error);
    });
    // 'finish' = everything was written to the socket; a client that went away mid-way is 'close' without it.
    res.on('finish', () => finish());
    res.on('close', () =>
      finish(
        res.writableFinished
          ? undefined
          : new Error('The client closed the connection'),
      ),
    );
    stream.pipe(res);
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
}
