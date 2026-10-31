import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { completionHeaders, completionTimeoutMs, DEFAULT_COMPLETION_TIMEOUT_MS, routeFor } from './openAiRequest.js';

describe('completionHeaders', () => {
  it('sends the key as a Bearer token by default (what gpt/deepseek/qwen always did)', () => {
    assert.deepEqual(completionHeaders({ apiKey: 'k' }), { Authorization: 'Bearer k', 'Content-Type': 'application/json' });
  });

  it('api-key scheme (Yandex Cloud) and none (a local server)', () => {
    assert.equal(completionHeaders({ apiKey: 'k', authScheme: 'api-key' }).Authorization, 'Api-Key k');
    assert.ok(!('Authorization' in completionHeaders({ apiKey: '', authScheme: 'none' })));
  });

  it('adds the key\'s extra headers but never lets them replace the request\'s own', () => {
    const headers = completionHeaders({
      apiKey: 'k',
      extraHeaders: { 'x-folder-id': 'b1g', 'Content-Type': 'text/plain', Host: 'evil', 'content-length': '1' },
    });

    assert.equal(headers['x-folder-id'], 'b1g');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.ok(!('Host' in headers) && !('content-length' in headers));
  });
});

describe('completionTimeoutMs', () => {
  it('is five minutes unless the key says otherwise', () => {
    assert.equal(completionTimeoutMs({}), DEFAULT_COMPLETION_TIMEOUT_MS);
    assert.equal(completionTimeoutMs({ timeoutSec: 900 }), 900_000);
    assert.equal(completionTimeoutMs({ timeoutSec: 0 }), DEFAULT_COMPLETION_TIMEOUT_MS);
  });
});

describe('routeFor', () => {
  it('sends a gpt-style key (no route) through the proxy exactly as before, and a private address around it', () => {
    assert.equal(routeFor({ baseUrl: 'https://api.openai.com/v1' }, 'http://p:1').via, 'vpn');
    assert.equal(routeFor({ baseUrl: 'http://192.168.1.2:8080/v1' }, 'http://p:1').via, 'direct');
  });
});
