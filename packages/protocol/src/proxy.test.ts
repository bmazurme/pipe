import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

import { setupProxy } from './proxy.js';

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;

describe('setupProxy', () => {
  const original = getGlobalDispatcher();
  let sentinel: Agent;

  function arm(): void {
    sentinel = new Agent();
    setGlobalDispatcher(sentinel);
  }

  afterEach(async () => {
    const installed = getGlobalDispatcher();
    setGlobalDispatcher(original);
    await installed.close();
  });

  it('leaves the dispatcher untouched and returns undefined when no variable is set', () => {
    arm();
    const lines: string[] = [];

    const result = setupProxy({ env: {}, log: (m) => lines.push(m) });

    assert.equal(result, undefined);
    assert.equal(getGlobalDispatcher(), sentinel);
    assert.deepEqual(lines, []);
  });

  for (const name of PROXY_VARS) {
    it(`installs a ProxyAgent when only ${name} is set`, () => {
      arm();
      const url = 'http://proxy.example.test:3128';

      const result = setupProxy({ env: { [name]: url }, log: () => {} });

      assert.equal(result, url);
      assert.ok(getGlobalDispatcher() instanceof EnvHttpProxyAgent);
    });
  }

  it('honours the precedence HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy', () => {
    const env: NodeJS.ProcessEnv = {
      HTTPS_PROXY: 'http://a.test:1',
      https_proxy: 'http://b.test:2',
      HTTP_PROXY: 'http://c.test:3',
      http_proxy: 'http://d.test:4',
    };
    const expected = ['http://a.test:1', 'http://b.test:2', 'http://c.test:3', 'http://d.test:4'];

    for (let i = 0; i < PROXY_VARS.length; i++) {
      arm();
      assert.equal(setupProxy({ env: { ...env }, log: () => {} }), expected[i]);
      delete env[PROXY_VARS[i]];
    }
  });

  it('sends requests to hosts listed in NO_PROXY directly and the rest through the proxy', async () => {
    arm();
    const seen: string[] = [];
    // Stand-in for the corporate proxy: records every CONNECT it receives.
    const net = await import('node:net');
    const proxy = net.createServer((sock) => {
      sock.once('data', (d) => {
        seen.push(String(d).split(' ')[1]);
        sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      });
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    const { port } = proxy.address() as import('node:net').AddressInfo;
    try {
      setupProxy({
        env: { HTTPS_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: 'internal.test,.corp.test' },
        log: () => {},
      });
      // Bypassed hosts must not reach the proxy (they fail on DNS instead).
      await assert.rejects(fetch('https://gitlab.internal.test/'));
      await assert.rejects(fetch('https://git.corp.test/'));
      assert.deepEqual(seen, []);
      // Anything else is tunnelled through the proxy (which answers 403 here).
      await assert.rejects(fetch('https://example.test/'));
      assert.deepEqual(seen, ['example.test:443']);
    } finally {
      proxy.close();
    }
  });

  it('logs only protocol//host, never credentials', () => {
    arm();
    const lines: string[] = [];

    setupProxy({
      env: { HTTPS_PROXY: 'http://user:secret@proxy.example.test:8080' },
      log: (m) => lines.push(m),
    });

    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('http://proxy.example.test:8080'), lines[0]);
    assert.ok(!lines[0].includes('secret'), lines[0]);
    assert.ok(!lines[0].includes('user'), lines[0]);
  });

  it('reads process.env and logs via console.log by default', () => {
    arm();
    const saved = new Map(PROXY_VARS.map((n) => [n, process.env[n]]));
    PROXY_VARS.forEach((n) => delete process.env[n]);
    process.env.HTTP_PROXY = 'http://proxy.example.test:3128';
    const calls: unknown[][] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => calls.push(args);
    try {
      assert.equal(setupProxy(), 'http://proxy.example.test:3128');
    } finally {
      console.log = origLog;
      for (const [n, v] of saved) {
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
    }
    assert.equal(calls.length, 1);
  });
});
