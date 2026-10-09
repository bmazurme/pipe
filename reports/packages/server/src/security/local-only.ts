import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

// reports' server has no login: it is a local tool, reachable only because it listens on the
// loopback interface. Two things still let a *web page* the user happens to open reach it:
//  - CORS `*`: any site could `fetch('http://127.0.0.1:4000/api/settings')` and read the reply;
//  - DNS rebinding: a hostile name that first resolves to the attacker, then to 127.0.0.1, makes
//    the browser treat this server as that site's own origin.
// Both are closed by trusting only requests that name this machine: loopback names, IP literals
// (a rebinding attack needs a *name*), and whatever the owner lists in ALLOWED_HOSTS.

function extraHosts(env: NodeJS.ProcessEnv): string[] {
  return (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

// `host` may carry a port ("localhost:4000") or be a bracketed IPv6 literal ("[::1]:4000").
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();

  if (value.startsWith('[')) return value.slice(1, value.indexOf(']'));

  const colon = value.lastIndexOf(':');

  return colon > -1 && value.indexOf(':') === colon ? value.slice(0, colon) : value;
}

export function isTrustedHostname(hostname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  // `new URL('http://[::1]:4000').hostname` keeps the IPv6 brackets.
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    isIP(name) !== 0 ||
    extraHosts(env).includes(name)
  );
}

export function isTrustedOrigin(origin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = (env.CLIENT_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (explicit.includes(origin.replace(/\/$/, ''))) return true;

  try {
    return isTrustedHostname(new URL(origin).hostname, env);
  } catch {
    return false;
  }
}

// For the `cors` package: no Origin header (same-origin GETs, curl, the CLI tools) passes;
// a trusted browser origin is echoed back; anything else gets no CORS headers at all.
export function corsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
  env: NodeJS.ProcessEnv = process.env,
): void {
  callback(null, !origin || isTrustedOrigin(origin, env));
}

// CORS only stops a page from *reading* a reply; a request still runs. This refuses it
// outright when it names a foreign Host (rebinding) or comes from a foreign browser origin.
export function localOnly(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = req.headers.host;
    const origin = req.headers.origin;

    if (host && !isTrustedHostname(hostnameOf(host), env)) {
      res.status(403).json({ type: 'error', data: 'Недопустимый заголовок Host' });
      return;
    }

    if (typeof origin === 'string' && !isTrustedOrigin(origin, env)) {
      res.status(403).json({ type: 'error', data: 'Запросы с чужих сайтов запрещены' });
      return;
    }

    next();
  };
}
