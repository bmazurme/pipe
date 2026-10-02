import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProxyAgent } from 'undici';

import { resolveDispatcher } from './proxyAgent.js';

describe('resolveDispatcher', () => {
  it('returns undefined when no proxy is configured', () => {
    assert.equal(resolveDispatcher(undefined), undefined);
  });

  it('returns a ProxyAgent when a proxy URL is given', () => {
    const dispatcher = resolveDispatcher('http://vpn-client:1080');
    assert.ok(dispatcher instanceof ProxyAgent);
  });

  it('reuses the same instance for repeated calls with the same URL', () => {
    const first = resolveDispatcher('http://vpn-client:1080');
    const second = resolveDispatcher('http://vpn-client:1080');
    assert.equal(first, second);
  });
});
