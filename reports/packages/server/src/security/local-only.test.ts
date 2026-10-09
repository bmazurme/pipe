import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

import { corsOrigin, hostnameOf, isTrustedHostname, isTrustedOrigin, localOnly } from './local-only';

const env = (values: Record<string, string> = {}) => values as NodeJS.ProcessEnv;

function run(headers: Record<string, string>, environment = env()) {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const next = vi.fn();

  localOnly(environment)({ headers } as unknown as Request, { status, json } as unknown as Response, next);

  return { status, json, next };
}

describe('hostnameOf', () => {
  it('strips the port, and reads a bracketed IPv6 literal', () => {
    expect(hostnameOf('localhost:4000')).toBe('localhost');
    expect(hostnameOf('127.0.0.1:4000')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:4000')).toBe('::1');
    expect(hostnameOf('LocalHost')).toBe('localhost');
  });
});

describe('isTrustedHostname', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '192.168.1.5', '::1'])('trusts %s', (host) => {
    expect(isTrustedHostname(host, env())).toBe(true);
  });

  it.each(['evil.example', 'localhost.evil.example', 'attacker.com'])('does not trust the name %s', (host) => {
    expect(isTrustedHostname(host, env())).toBe(false);
  });

  it('trusts the names the owner lists in ALLOWED_HOSTS', () => {
    expect(isTrustedHostname('reports.lan', env({ ALLOWED_HOSTS: 'reports.lan, other.lan' }))).toBe(true);
  });
});

describe('isTrustedOrigin / corsOrigin', () => {
  it('accepts the dev client and this server, on loopback names or IPs', () => {
    for (const origin of ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:4000', 'http://[::1]:4000']) {
      expect(isTrustedOrigin(origin, env())).toBe(true);
    }
  });

  it('refuses a foreign site and a malformed origin', () => {
    expect(isTrustedOrigin('https://evil.example', env())).toBe(false);
    expect(isTrustedOrigin('null', env())).toBe(false);
    expect(isTrustedOrigin('not a url', env())).toBe(false);
  });

  it('accepts an origin listed in CLIENT_ORIGIN', () => {
    expect(isTrustedOrigin('https://reports.example.com', env({ CLIENT_ORIGIN: 'https://reports.example.com/' }))).toBe(true);
  });

  it('lets a request without an Origin (same-origin, curl, the CLIs) through, and withholds CORS from a foreign one', () => {
    const results: boolean[] = [];

    corsOrigin(undefined, (_error, allow) => results.push(Boolean(allow)), env());
    corsOrigin('http://localhost:5174', (_error, allow) => results.push(Boolean(allow)), env());
    corsOrigin('https://evil.example', (_error, allow) => results.push(Boolean(allow)), env());

    expect(results).toEqual([true, true, false]);
  });
});

describe('localOnly middleware', () => {
  it('passes a normal local request', () => {
    const { next, status } = run({ host: 'localhost:4000', origin: 'http://localhost:5174' });

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('refuses a request from a foreign origin outright, not just its CORS headers', () => {
    const { next, status } = run({ host: '127.0.0.1:4000', origin: 'https://evil.example' });

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('refuses a rebinding request: a foreign Host name pointing at this machine', () => {
    const { next, status } = run({ host: 'evil.example:4000' });

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('lets through a request with neither header', () => {
    expect(run({}).next).toHaveBeenCalledTimes(1);
  });
});
