import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';

import { setupProxy } from './setupProxy.js';

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;

describe('setupProxy', () => {
  const savedEnv = new Map<string, string | undefined>();
  let savedDispatcher: Dispatcher;
  let sentinel: Agent;

  beforeEach(() => {
    for (const name of PROXY_VARS) {
      savedEnv.set(name, process.env[name]);
      delete process.env[name];
    }
    savedDispatcher = getGlobalDispatcher();
    sentinel = new Agent();
    setGlobalDispatcher(sentinel);
  });

  afterEach(async () => {
    const installed = getGlobalDispatcher();
    setGlobalDispatcher(savedDispatcher);
    for (const name of PROXY_VARS) {
      const value = savedEnv.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    if (installed !== savedDispatcher) {
      await installed.close();
    }
  });

  function captureInfo(fn: () => void): unknown[][] {
    const calls: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => calls.push(args);
    try {
      fn();
    } finally {
      console.log = original;
    }
    return calls;
  }

  it('leaves the global dispatcher untouched when no proxy env var is set', () => {
    const calls = captureInfo(() => setupProxy());

    assert.equal(getGlobalDispatcher(), sentinel);
    assert.deepEqual(calls, []);
  });

  for (const name of PROXY_VARS) {
    it(`installs a ProxyAgent when only ${name} is set`, () => {
      process.env[name] = 'http://proxy.example.test:3128';

      captureInfo(() => setupProxy());

      assert.notEqual(getGlobalDispatcher(), sentinel);
      assert.ok(getGlobalDispatcher() instanceof ProxyAgent);
    });
  }

  it('prefers HTTPS_PROXY over HTTP_PROXY and logs the https proxy host', () => {
    process.env.HTTPS_PROXY = 'https://secure-proxy.example.test:8443';
    process.env.HTTP_PROXY = 'http://plain-proxy.example.test:3128';

    const calls = captureInfo(() => setupProxy());

    assert.ok(getGlobalDispatcher() instanceof ProxyAgent);
    assert.equal(calls.length, 1);
    const line = String(calls[0][0]);
    assert.ok(line.includes('https://secure-proxy.example.test:8443'), line);
    assert.ok(!line.includes('plain-proxy'), line);
  });
});
