import { isIP } from 'node:net';

import { parseVlessLink } from '../worker/vless-link';

// A VPN subscription is an https:// address that answers with a list of client links — plain text, one per line, or the same
// list base64-encoded (what v2rayN, Hiddify and most providers serve). Only links a worker's tunnel can run are usable: vless
// with Reality over tcp. Everything else on the list (vmess, trojan, hysteria, …) is counted and skipped.
export interface ParsedSubscription {
  /** vless:// Reality/tcp links, in the order the provider listed them. */
  links: string[];
  /** Lines that were links of some other kind or could not be run. */
  unsupported: number;
}

function decodeBase64(text: string): string | null {
  const compact = text.replace(/\s+/g, '');

  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;

  const decoded = Buffer.from(
    compact.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf8');

  return decoded.includes('://') ? decoded : null;
}

export function parseSubscriptionBody(body: string): ParsedSubscription {
  const text = body.trim();
  const plain = text.includes('://') ? text : (decodeBase64(text) ?? text);
  const links: string[] = [];
  let unsupported = 0;

  for (const raw of plain.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith('#')) continue;

    if (!line.toLowerCase().startsWith('vless://')) {
      if (line.includes('://')) unsupported += 1;
      continue;
    }

    try {
      parseVlessLink(line);
      links.push(line);
    } catch {
      unsupported += 1;
    }
  }

  return { links, unsupported };
}

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

// Bridge fetches an address the owner typed in, from inside the stack's network: never a name or literal that points at the
// stack itself. A name that resolves to a private address is not caught here (that needs a lookup per request); the route is
// owner-only, and this is a guard against pasting the wrong thing, not against a hostile owner.
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('это не ссылка https://…');
  }

  if (url.protocol !== 'https:') {
    throw new Error('ссылка подписки должна начинаться с https://');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(host);
  const privateV6 =
    version === 6 &&
    (host === '::1' ||
      host === '::' ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host));

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    privateV6 ||
    (version === 4 && PRIVATE_V4.some((pattern) => pattern.test(host)))
  ) {
    throw new Error('адрес подписки указывает на внутреннюю сеть');
  }

  return url;
}

// The profile name providers put after the # of a subscription link (Hiddify: …#PaperVPN), if any.
export function subscriptionName(raw: string): string | null {
  try {
    const name = decodeURIComponent(new URL(raw.trim()).hash.slice(1)).trim();

    return name || null;
  } catch {
    return null;
  }
}

// The link as shown to the owner: the provider's remark replaced with the connection's own name.
export function renameLink(link: string, name: string): string {
  const at = link.indexOf('#');
  const base = at === -1 ? link : link.slice(0, at);

  return `${base}#${encodeURIComponent(name)}`;
}
