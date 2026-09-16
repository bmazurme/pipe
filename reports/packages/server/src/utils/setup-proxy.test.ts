import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const setGlobalDispatcher = vi.fn();
const ProxyAgent = vi.fn(function ProxyAgent(this: { url: string }, url: string) {
  this.url = url;
});

vi.mock('undici', () => ({ setGlobalDispatcher, ProxyAgent }));

const { setupProxy } = await import('./setup-proxy');

const ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  setGlobalDispatcher.mockClear();
  ProxyAgent.mockClear();
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  });
});

describe('setupProxy', () => {
  it('does nothing when no proxy env var is set', () => {
    setupProxy();

    expect(setGlobalDispatcher).not.toHaveBeenCalled();
  });

  it('configures a global ProxyAgent from HTTPS_PROXY', () => {
    process.env.HTTPS_PROXY = 'http://user:pass@proxy.example.com:8080';

    setupProxy();

    expect(ProxyAgent).toHaveBeenCalledWith('http://user:pass@proxy.example.com:8080');
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1);
  });
});
