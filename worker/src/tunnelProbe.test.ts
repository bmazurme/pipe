import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyError, classifyStatus, E2E_TARGETS, probeTarget, reportE2e, TunnelProbe, type E2eOutcome } from './tunnelProbe.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const err = (props: object) => Object.assign(new Error('x'), props);

describe('classifyStatus', () => {
  it('treats an answer as the request going through — a 404 or a 302 is what a good exit gets', () => {
    for (const status of [200, 204, 302, 401, 404, 405, 429]) assert.deepEqual(classifyStatus(status), { result: 'ok' });
  });

  it('treats 403 (Anthropic: "Request not allowed" from a region it refuses, which is what a bad exit gives) and 5xx as failures', () => {
    assert.deepEqual(classifyStatus(403), { result: 'error', detail: 'HTTP 403' });
    assert.deepEqual(classifyStatus(502), { result: 'error', detail: 'HTTP 502' });
    assert.deepEqual(classifyStatus(503), { result: 'error', detail: 'HTTP 503' });
  });
});

describe('classifyError', () => {
  it('knows silence (throttling), a proxy that is down, a reset, and anything else', () => {
    assert.deepEqual(classifyError(err({ name: 'TimeoutError' })), { result: 'tls_timeout', detail: 'timeout' });
    assert.deepEqual(classifyError(err({ name: 'AbortError' })), { result: 'tls_timeout', detail: 'timeout' });
    assert.deepEqual(classifyError(err({ code: 'UND_ERR_HEADERS_TIMEOUT' })), { result: 'tls_timeout', detail: 'timeout' });
    assert.deepEqual(classifyError(err({ code: 'UND_ERR_CONNECT_TIMEOUT' })), { result: 'tls_timeout', detail: 'timeout' });
    assert.deepEqual(classifyError(err({ code: 'ECONNREFUSED' })), { result: 'tcp_refused', detail: 'proxy' });
    assert.deepEqual(classifyError(err({ code: 'ECONNRESET' })), { result: 'tls_reset', detail: 'ECONNRESET' });
    assert.deepEqual(classifyError(err({ code: 'UND_ERR_SOCKET' })), { result: 'tls_reset', detail: 'UND_ERR_SOCKET' });
  });

  it('reads the code from undici\'s `cause` too, and bounds what it keeps of an unknown error', () => {
    assert.equal(classifyError(err({ cause: { code: 'ECONNREFUSED' } })).result, 'tcp_refused');
    assert.deepEqual(classifyError(err({ message: 'weird' })), { result: 'error', detail: 'weird' });
    assert.equal(classifyError(new Error('m'.repeat(300))).detail?.length, 60);
    assert.equal(classifyError(undefined).result, 'error');
  });
});

describe('probeTarget', () => {
  const target = { key: 'e2e:claude', url: 'https://api.anthropic.com/' };

  it('asks the target through the given proxy and reports how long it took', async () => {
    let seen: unknown[] = [];
    let t = 1000;
    const outcome = await probeTarget(target, 'http://127.0.0.1:18080', {
      request: async (...args) => {
        seen = args;
        t += 480;

        return 404;
      },
      now: () => t,
    });

    assert.deepEqual(seen, ['https://api.anthropic.com/', 'http://127.0.0.1:18080', 10_000]);
    assert.deepEqual(outcome, { key: 'e2e:claude', result: 'ok', tcpMs: 480 });
  });

  it('reports a forbidden answer and a thrown error as failures, with no timing for the latter', async () => {
    assert.deepEqual(await probeTarget(target, 'http://p', { request: async () => 403, now: () => 0 }), { key: 'e2e:claude', result: 'error', detail: 'HTTP 403', tcpMs: 0 });
    assert.deepEqual(await probeTarget(target, 'http://p', { request: async () => { throw err({ code: 'ECONNREFUSED' }); } }), { key: 'e2e:claude', result: 'tcp_refused', detail: 'proxy' });
  });
});

describe('TunnelProbe', () => {
  const build = (over: { intervalMs?: number; request?: (url: string) => Promise<number> } = {}) => {
    const clock = { t: 100_000 };
    const sent: { apiUrl: string; key: string; results: E2eOutcome[] }[] = [];
    const requested: string[] = [];
    const warns: string[] = [];
    const probe = new TunnelProbe({
      apiUrl: 'https://bridge.example.com',
      now: () => clock.t,
      intervalMs: over.intervalMs,
      request: async (url) => {
        requested.push(url);

        return over.request ? over.request(url) : 200;
      },
      send: async (apiUrl, key, results) => void sent.push({ apiUrl, key, results }),
      log: { info: () => undefined, warn: (_o, m) => warns.push(m) },
    });

    return { probe, clock, sent, requested, warns };
  };

  it('asks every target through the proxy the worker runs through, and reports all of them under the worker key, in order', async () => {
    const { probe, sent, requested } = build();

    probe.consider({ proxyUrl: 'http://127.0.0.1:18080' }, 'brw_key');
    await settle();
    await settle();

    assert.deepEqual(requested, E2E_TARGETS.map((target) => target.url));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].apiUrl, 'https://bridge.example.com');
    assert.equal(sent[0].key, 'brw_key');
    assert.deepEqual(sent[0].results.map((r) => [r.key, r.result]), [['e2e:claude', 'ok'], ['e2e:telegram', 'ok'], ['e2e:github', 'ok']]);
  });

  it('reports a target that fails next to the ones that work', async () => {
    const { probe, sent } = build({ request: async (url) => (url.includes('anthropic') ? 403 : 302) });

    probe.consider({ proxyUrl: 'http://p:1' }, 'k');
    await settle();
    await settle();

    assert.deepEqual(sent[0].results.map((r) => [r.key, r.result, r.detail ?? null]), [['e2e:claude', 'error', 'HTTP 403'], ['e2e:telegram', 'ok', null], ['e2e:github', 'ok', null]]);
  });

  it('does nothing without a proxy: there is no tunnel to check', async () => {
    const { probe, sent, requested } = build();

    probe.consider({}, 'k');
    probe.consider({ proxyUrl: null }, 'k');
    probe.consider({ proxyUrl: '  ' }, 'k');
    await settle();

    assert.deepEqual([requested.length, sent.length], [0, 0]);
  });

  it('makes a round about once a minute, however often the settings are fetched, and not two at once', async () => {
    const { probe, clock, sent } = build();

    probe.consider({ proxyUrl: 'http://p:1' }, 'k');
    probe.consider({ proxyUrl: 'http://p:1' }, 'k');
    await settle();
    await settle();
    clock.t += 30_000;
    probe.consider({ proxyUrl: 'http://p:1' }, 'k');
    await settle();
    assert.equal(sent.length, 1);

    clock.t += 31_000;
    probe.consider({ proxyUrl: 'http://p:1' }, 'k');
    await settle();
    await settle();
    assert.equal(sent.length, 2);
  });

  it('never throws, and a failing report is only logged', async () => {
    const probe = new TunnelProbe({
      apiUrl: 'https://b',
      request: async () => 200,
      send: async () => {
        throw new Error('bridge down');
      },
      log: { info: () => undefined, warn: () => undefined },
    });

    assert.doesNotThrow(() => probe.consider({ proxyUrl: 'http://p:1' }, 'k'));
    await settle();
    await settle();
  });
});

describe('reportE2e', () => {
  it('posts the results to the worker route with the worker key, and swallows every failure', async () => {
    const original = globalThis.fetch;
    const seen: { url: string; auth: string | null; body: unknown }[] = [];

    try {
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        seen.push({ url, auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });

        return new Response(null, { status: 204 });
      }) as typeof fetch;
      await reportE2e('https://bridge.example.com', 'brw_k', [{ key: 'e2e:claude', result: 'ok', tcpMs: 480 }]);

      assert.deepEqual(seen, [{ url: 'https://bridge.example.com/api/v1/worker/links', auth: 'Bearer brw_k', body: { results: [{ key: 'e2e:claude', result: 'ok', tcpMs: 480 }] } }]);

      globalThis.fetch = (async () => new Response('no', { status: 404 })) as typeof fetch;
      await assert.doesNotReject(reportE2e('https://bridge.example.com', 'k', []));
      globalThis.fetch = (async () => {
        throw new Error('network');
      }) as typeof fetch;
      await assert.doesNotReject(reportE2e('https://bridge.example.com', 'k', []));
    } finally {
      globalThis.fetch = original;
    }
  });
});
