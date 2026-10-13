import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { IncomingMessage } from 'http';
import { Readable } from 'stream';

import express from 'express';
import request from 'supertest';

import { FileMissingError, type FileStore } from './file-store';
import { LocalFileStore } from './local-file-store';
import {
  sendStoredFile,
  type SendDone,
  type SendMode,
} from './send-stored-file';

// A remote-style store: no local path, bytes come as a stream.
function remoteStore(
  files: Record<string, Buffer | (() => Readable)>,
): FileStore {
  return {
    driver: 's3',
    localPath: () => null,
    adopt: jest.fn(),
    put: jest.fn(),
    remove: jest.fn(),
    readBytes: jest.fn(),
    stat: async (key) => {
      const file = files[key];

      return file === undefined
        ? null
        : { size: Buffer.isBuffer(file) ? file.length : 1000 };
    },
    openRead: async (key) => {
      const file = files[key];

      if (file === undefined) throw new FileMissingError(key);

      return Buffer.isBuffer(file) ? Readable.from([file]) : file();
    },
  };
}

// The result of every send, to assert "reported exactly once".
function appWith(
  store: FileStore,
  mode: SendMode,
  beforeSend?: (res: express.Response) => void,
) {
  const done = jest.fn<void, Parameters<SendDone>>();
  const app = express();

  app.get('/f/*', (req, res) => {
    beforeSend?.(res);
    sendStoredFile(
      store,
      res,
      (req.params as unknown as string[])[0],
      mode,
      (error) => {
        done(error);
        if (error && !res.headersSent)
          res.status(404).json({ message: 'File is missing' });
      },
    );
  });

  return { app, done };
}

const binary = (
  res: IncomingMessage,
  cb: (error: Error | null, body: Buffer) => void,
): void => {
  const chunks: Buffer[] = [];

  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('sendStoredFile', () => {
  describe('a plain local file (Express does the work, as before)', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'send-local-'));
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('sends it as a download under the original name and reports success once', async () => {
      const store = new LocalFileStore(root);
      await store.put('abc.zip', Buffer.from('zip-bytes'));
      const { app, done } = appWith(store, {
        kind: 'download',
        filename: 'парсел.zip',
      });

      const res = await request(app)
        .get('/f/abc.zip')
        .buffer()
        .parse(binary as never)
        .expect(200);

      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(decodeURIComponent(res.headers['content-disposition'])).toContain(
        'парсел.zip',
      );
      expect((res.body as Buffer).toString()).toBe('zip-bytes');
      expect(done).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(undefined);
    });

    it('reports a missing file through the callback', async () => {
      const { app, done } = appWith(new LocalFileStore(root), {
        kind: 'download',
        filename: 'x.zip',
      });

      await request(app).get('/f/gone.zip').expect(404);

      expect(done).toHaveBeenCalledTimes(1);
      expect(done.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('serves inline (sendFile) without an attachment header', async () => {
      const store = new LocalFileStore(root);
      await store.put('chat/p.png', Buffer.from('png'));
      const { app, done } = appWith(store, { kind: 'inline' }, (res) =>
        res.setHeader('Content-Type', 'image/png'),
      );

      const res = await request(app).get('/f/chat/p.png').expect(200);

      expect(res.headers['content-disposition']).toBeUndefined();
      expect(res.headers['content-type']).toContain('image/png');
      expect(done).toHaveBeenCalledWith(undefined);
    });
  });

  describe('a remote store (streamed)', () => {
    it('streams the bytes as a download with the right length and name, and reports success once', async () => {
      const store = remoteStore({ 'abc.zip': Buffer.from('remote-bytes') });
      const { app, done } = appWith(store, {
        kind: 'download',
        filename: 'p.zip',
      });

      const res = await request(app)
        .get('/f/abc.zip')
        .buffer()
        .parse(binary as never)
        .expect(200);

      expect((res.body as Buffer).toString()).toBe('remote-bytes');
      expect(res.headers['content-length']).toBe(String('remote-bytes'.length));
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('p.zip');
      expect(done).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(undefined);
    });

    it('answers a missing file before any byte is written, through the callback', async () => {
      const { app, done } = appWith(remoteStore({}), {
        kind: 'download',
        filename: 'x.zip',
      });

      const res = await request(app).get('/f/gone.zip').expect(404);

      expect(res.body).toEqual({ message: 'File is missing' });
      expect(done).toHaveBeenCalledTimes(1);
      expect(done.mock.calls[0][0]).toBeInstanceOf(FileMissingError);
    });

    it('keeps the headers the caller set for an inline file and adds no attachment header', async () => {
      const store = remoteStore({ 'chat/p.png': Buffer.from('png') });
      const { app } = appWith(store, { kind: 'inline' }, (res) => {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      });

      const res = await request(app).get('/f/chat/p.png').expect(200);

      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBeUndefined();
    });

    it('reports a stream that breaks half way, exactly once, and ends the connection', async () => {
      const store = remoteStore({
        'big.zip': () => {
          const stream = new Readable({ read() {} });

          stream.push(Buffer.from('first-part'));
          setImmediate(() =>
            stream.destroy(new Error('connection to the bucket lost')),
          );

          return stream;
        },
      });
      const { app, done } = appWith(store, {
        kind: 'download',
        filename: 'big.zip',
      });

      await request(app)
        .get('/f/big.zip')
        .catch(() => undefined); // the client sees a broken response

      expect(done).toHaveBeenCalledTimes(1);
      expect(done.mock.calls[0][0]).toMatchObject({
        message: 'connection to the bucket lost',
      });
    });

    it('treats a client that went away before the end as a failure, not a success (nothing is deleted after a half download)', async () => {
      const { EventEmitter } = await import('events');
      const res = Object.assign(new EventEmitter(), {
        attachment: jest.fn(),
        setHeader: jest.fn(),
        destroy: jest.fn(),
        writableFinished: false,
        write: jest.fn(),
        end: jest.fn(),
      });
      const never = new Readable({ read() {} });
      const done = jest.fn();

      sendStoredFile(
        remoteStore({ 'a.zip': () => never }),
        res as never,
        'a.zip',
        { kind: 'download', filename: 'a.zip' },
        done,
      );
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      res.emit('close');

      expect(done).toHaveBeenCalledTimes(1);
      expect(done.mock.calls[0][0]).toMatchObject({
        message: 'The client closed the connection',
      });
    });
  });
});
