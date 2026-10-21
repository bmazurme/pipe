import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { FusionAddinError, FusionClient } from './client.js';

const TOKEN = 't'.repeat(32);

// A stand-in for the add-in: it checks the token and answers like the real one.
describe('FusionClient', () => {
  let server: Server;
  let client: FusionClient;
  let seen: { method?: string; url?: string; body: unknown }[] = [];

  const readBody = (request: IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let raw = '';

      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => resolve(raw ? JSON.parse(raw) : undefined));
    });

  before(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      void readBody(request).then((body) => {
        seen.push({ method: request.method, url: request.url, body });

        if (request.headers.authorization !== `Bearer ${TOKEN}`) {
          response.writeHead(401).end();

          return;
        }
        if (request.url === '/health') {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, app: 'Fusion', version: '2.0', document: 'boat' }));
        } else if (request.url === '/info') {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ bodies: 2 }));
        } else if (request.url === '/run') {
          response
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ ok: true, stdout: 'hi\n', stderr: '', error: null, traceback: null, result: { n: 1 } }));
        } else if (request.url === '/screenshot' || request.url === '/export') {
          response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(Buffer.from([1, 2, 3]));
        } else {
          response.writeHead(500).end('boom');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    client = new FusionClient({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: TOKEN });
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('asks the add-in about itself and the design', async () => {
    assert.deepEqual(await client.health(), { ok: true, app: 'Fusion', version: '2.0', document: 'boat' });
    assert.deepEqual(await client.info(), { bodies: 2 });
  });

  it('sends a script with its name and timeout and returns what it printed', async () => {
    seen = [];
    const result = await client.run('print("hi")', 'make.py', 30);

    assert.equal(result.stdout, 'hi\n');
    assert.deepEqual(result.result, { n: 1 });
    assert.deepEqual(seen[0].body, { name: 'make.py', source: 'print("hi")', timeoutSec: 30 });
  });

  it('returns pictures and exports as bytes', async () => {
    seen = [];

    assert.deepEqual([...(await client.screenshot('top', 800, 600))], [1, 2, 3]);
    assert.deepEqual(seen[0].body, { view: 'top', width: 800, height: 600 });
    assert.deepEqual([...(await client.export('step'))], [1, 2, 3]);
    assert.deepEqual(seen[1].body, { format: 'step' });
  });

  it('says so when the token is refused, the add-in fails, or it cannot be reached', async () => {
    const wrongToken = new FusionClient({ url: (client as unknown as { config: { url: string } }).config.url, token: 'x'.repeat(32) });

    await assert.rejects(() => wrongToken.health(), (error: unknown) => error instanceof FusionAddinError && /refused the token/.test(error.message));

    const broken = new FusionClient({ url: (client as unknown as { config: { url: string } }).config.url, token: TOKEN }, ((url: string, init?: RequestInit) =>
      fetch(`${url}-missing`, init)) as typeof fetch);

    await assert.rejects(() => broken.health(), (error: unknown) => error instanceof FusionAddinError && /answered 500: boom/.test(error.message));

    const unreachable = new FusionClient({ url: 'http://127.0.0.1:1', token: TOKEN });

    await assert.rejects(() => unreachable.health(), (error: unknown) => error instanceof FusionAddinError && /Cannot reach the pipe add-in/.test(error.message));
  });
});
