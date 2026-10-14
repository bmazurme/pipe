import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { enrollWorker, EnrollmentRejectedError } from './enrollment.js';
import { BridgeHttpError } from './bridgeHttp.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe('enrollWorker', () => {
  it('sends the one-time code with the host and version, and returns the worker’s own key', async () => {
    let url = '';
    let body: unknown;
    let auth: string | null | undefined;

    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      url = u;
      body = JSON.parse(init?.body as string);
      auth = new Headers(init?.headers).get('authorization');

      return new Response(JSON.stringify({ workerId: 5, name: 'green', key: 'brw_k' }), { status: 200 });
    }) as typeof fetch;

    const creds = await enrollWorker('https://bridge.example.com', '  brn_code  ', '1.2.3', 'box');

    assert.equal(url, 'https://bridge.example.com/api/v1/workers/enroll');
    assert.deepEqual(body, { code: 'brn_code', hostname: 'box', version: '1.2.3' });
    assert.equal(auth, null, 'the code is the credential: no Authorization header is sent');
    assert.equal(creds.key, 'brw_k');
    assert.equal(creds.name, 'green');
    assert.equal(creds.workerId, 5);
    assert.equal(creds.bridgeApiUrl, 'https://bridge.example.com');
  });

  it('says plainly when the code was refused', async () => {
    globalThis.fetch = (async () => new Response('{"message":"Invalid or expired enrollment code"}', { status: 401 })) as typeof fetch;

    await assert.rejects(enrollWorker('https://bridge.example.com', 'brn_old', '1', 'box'), EnrollmentRejectedError);
  });

  it('passes any other failure through (bridge down is not "the code is wrong")', async () => {
    globalThis.fetch = (async () => new Response('bad gateway', { status: 502 })) as typeof fetch;

    await assert.rejects(enrollWorker('https://bridge.example.com', 'brn_x', '1', 'box'), (error: unknown) => {
      assert.ok(error instanceof BridgeHttpError);
      assert.equal((error as BridgeHttpError).status, 502);
      return true;
    });
  });
});
