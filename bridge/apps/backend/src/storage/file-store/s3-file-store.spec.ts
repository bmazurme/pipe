import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { HttpResponse } from '@smithy/core/protocols';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { FileMissingError } from './file-store';
import { isEndpointFailure, S3FileStore } from './s3-file-store';

type Send = jest.Mock<
  Promise<unknown>,
  [{ constructor: { name: string }; input: Record<string, unknown> }]
>;

const options = (endpoints: string[]) => ({
  endpoints,
  region: 'garage',
  bucket: 'bridge-uploads',
  accessKeyId: 'k',
  secretAccessKey: 's',
});

// One fake client per endpoint: a `send` we control.
function build(endpoints: string[]) {
  const sends = new Map<string, Send>(
    endpoints.map((e) => [e, jest.fn() as Send]),
  );
  const store = new S3FileStore(
    options(endpoints),
    (endpoint) =>
      ({ send: sends.get(endpoint), config: {} }) as unknown as S3Client,
  );

  return { store, sends };
}

// A REAL S3Client (what lib-storage's Upload needs) whose HTTP layer is ours: records the requests,
// answers 200, or fails the way a dead node does.
type Seen = { method: string; path: string };

function realClientFactory(behaviour: Record<string, 'ok' | Error>) {
  const seen = new Map<string, Seen[]>();
  const factory = (endpoint: string) => {
    seen.set(endpoint, []);

    return new S3Client({
      endpoint,
      region: 'garage',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: {
        metadata: { handlerProtocol: 'http/1.1' },
        destroy: () => undefined,
        handle: async (request: { method: string; path: string }) => {
          seen
            .get(endpoint)!
            .push({ method: request.method, path: request.path });
          const outcome = behaviour[endpoint] ?? 'ok';

          if (outcome !== 'ok') throw outcome;

          return {
            response: new HttpResponse({
              statusCode: 200,
              headers: { etag: '"abc"' },
            }),
          };
        },
      } as never,
    });
  };

  return { factory, seen };
}

const refused = Object.assign(new Error('connect ECONNREFUSED'), {
  code: 'ECONNREFUSED',
});
const noKey = Object.assign(new Error('nope'), {
  name: 'NoSuchKey',
  $metadata: { httpStatusCode: 404 },
});
const denied = Object.assign(new Error('denied'), {
  name: 'AccessDenied',
  $metadata: { httpStatusCode: 403 },
});
const unavailable = Object.assign(new Error('quorum'), {
  name: 'ServiceUnavailable',
  $metadata: { httpStatusCode: 503 },
});

describe('S3FileStore', () => {
  it('puts an object into the bucket under its key', async () => {
    const { store, sends } = build(['http://a']);
    sends.get('http://a')!.mockResolvedValue({});

    await store.put('x.zip', Buffer.from('zip'));

    const command = sends.get('http://a')!.mock.calls[0][0];

    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'bridge-uploads',
      Key: 'x.zip',
    });
  });

  it('stats an object (size from HEAD) and says null when it is not there', async () => {
    const { store, sends } = build(['http://a']);
    const send = sends.get('http://a')!;

    send.mockResolvedValueOnce({ ContentLength: 42 });
    expect(await store.stat('x.zip')).toEqual({ size: 42 });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);

    send.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    expect(await store.stat('gone.zip')).toBeNull();
  });

  it('reads an object as a stream and as bytes', async () => {
    const { store, sends } = build(['http://a']);
    const send = sends.get('http://a')!;

    send.mockImplementation(async () => ({
      Body: Readable.from([Buffer.from('he'), Buffer.from('llo')]),
    }));

    expect(await store.readBytes('x.zip')).toEqual(Buffer.from('hello'));
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'bridge-uploads',
      Key: 'x.zip',
    });
  });

  it('turns a missing object into FileMissingError', async () => {
    const { store, sends } = build(['http://a']);
    sends.get('http://a')!.mockRejectedValue(noKey);

    await expect(store.readBytes('gone.zip')).rejects.toBeInstanceOf(
      FileMissingError,
    );
  });

  it('removes an object', async () => {
    const { store, sends } = build(['http://a']);
    sends.get('http://a')!.mockResolvedValue({});

    await store.remove('x.zip');

    expect(sends.get('http://a')!.mock.calls[0][0]).toBeInstanceOf(
      DeleteObjectCommand,
    );
  });

  describe('adopt (a staged upload)', () => {
    let dir: string;
    let staged: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 's3-staging-'));
      staged = join(dir, 'u.zip');
      writeFileSync(staged, 'payload');
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('uploads the file under its key in the bucket and deletes the staging copy', async () => {
      const { factory, seen } = realClientFactory({});
      const store = new S3FileStore(options(['http://a']), factory);

      await store.adopt('chat/u.zip', staged);

      expect(seen.get('http://a')).toEqual([
        { method: 'PUT', path: '/bridge-uploads/chat/u.zip' },
      ]);
      expect(existsSync(staged)).toBe(false);
    });

    it('deletes the staging copy even when the upload fails, and says why', async () => {
      const { factory } = realClientFactory({ 'http://a': denied });
      const store = new S3FileStore(options(['http://a']), factory);

      await expect(store.adopt('u.zip', staged)).rejects.toThrow('denied');

      expect(existsSync(staged)).toBe(false);
    });

    it('retries on the next endpoint with a fresh read of the same file', async () => {
      const { factory, seen } = realClientFactory({ 'http://a': refused });
      const store = new S3FileStore(options(['http://a', 'http://b']), factory);

      await store.adopt('u.zip', staged);

      expect(seen.get('http://b')).toEqual([
        { method: 'PUT', path: '/bridge-uploads/u.zip' },
      ]);
      expect(existsSync(staged)).toBe(false);
    });
  });

  describe('endpoints', () => {
    it('goes on to the next endpoint when one cannot be reached, and prefers the one that worked', async () => {
      const { store, sends } = build(['http://a', 'http://b']);
      sends.get('http://a')!.mockRejectedValue(refused);
      sends.get('http://b')!.mockResolvedValue({ ContentLength: 1 });

      await store.stat('x');
      await store.stat('y');

      expect(sends.get('http://a')!.mock.calls).toHaveLength(1); // the second call went straight to b
      expect(sends.get('http://b')!.mock.calls).toHaveLength(2);
    });

    it('treats a 503 (Garage without quorum) as a reason to try another node', async () => {
      const { store, sends } = build(['http://a', 'http://b']);
      sends.get('http://a')!.mockRejectedValue(unavailable);
      sends.get('http://b')!.mockResolvedValue({});

      await expect(store.put('x', Buffer.from('1'))).resolves.toBeUndefined();
    });

    it('does not retry a refusal another node would repeat', async () => {
      const { store, sends } = build(['http://a', 'http://b']);
      sends.get('http://a')!.mockRejectedValue(denied);

      await expect(store.put('x', Buffer.from('1'))).rejects.toThrow('denied');

      expect(sends.get('http://b')!.mock.calls).toHaveLength(0);
    });

    it('gives the last error when every endpoint is down', async () => {
      const { store, sends } = build(['http://a', 'http://b']);
      sends.get('http://a')!.mockRejectedValue(refused);
      sends
        .get('http://b')!
        .mockRejectedValue(
          Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
        );

      await expect(store.stat('x')).rejects.toThrow('timed out');
    });

    it('needs at least one endpoint', () => {
      expect(() => new S3FileStore(options([]))).toThrow(
        /at least one endpoint/,
      );
    });
  });

  describe('isEndpointFailure', () => {
    it.each([
      ['connection refused', refused, true],
      [
        'a timeout',
        Object.assign(new Error('t'), { name: 'TimeoutError' }),
        true,
      ],
      [
        'a socket error code on the cause',
        { cause: { code: 'ECONNRESET' } },
        true,
      ],
      [
        'a 500',
        Object.assign(new Error('e'), { $metadata: { httpStatusCode: 500 } }),
        true,
      ],
      ['a 503', unavailable, true],
      ['access denied', denied, false],
      ['a missing key', noKey, false],
      [
        'no such bucket',
        Object.assign(new Error('b'), {
          name: 'NoSuchBucket',
          $metadata: { httpStatusCode: 404 },
        }),
        false,
      ],
    ])('%s → %s', (_label, error, expected) => {
      expect(isEndpointFailure(error)).toBe(expected);
    });
  });
});
