// How a request to a model server travels: straight from this machine, or through the worker's proxy (its VPN tunnel's
// loopback proxy, or a proxy set by hand). Decided per request from what the key says and what the worker has right now,
// so switching the key's route or the worker's VPN takes effect on the next job/turn without a restart.
export type RouteMode = 'auto' | 'vpn' | 'direct';

export const ROUTE_MODES: readonly RouteMode[] = ['auto', 'vpn', 'direct'];

export interface RouteDecision {
  via: 'direct' | 'vpn';
  /** The proxy to send the request through; undefined = no proxy. */
  proxyUrl: string | undefined;
  /** One line for the job log: what was chosen and why. Never contains the address or credentials. */
  reason: string;
}

export class RouteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteUnavailableError';
  }
}

export function isRouteMode(value: unknown): value is RouteMode {
  return ROUTE_MODES.includes(value as RouteMode);
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Addresses that only make sense inside a network: a request to them must not be sent through a VPN that lives elsewhere.
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (host === '') return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal')) {
    return true;
  }

  const match = IPV4.exec(host);

  if (match) {
    const [a, b] = [Number(match[1]), Number(match[2])];

    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT, which Tailscale uses
    );
  }

  if (host.includes(':')) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host);
  }

  // a single label ("ollama", "mac-fusion") is resolved by the local network, not the internet
  return !host.includes('.');
}

export interface RouteInput {
  /** The model server's base URL. */
  url: string;
  /** The key's route; auto when the key has none (gpt/deepseek/qwen keys). */
  route?: RouteMode | null;
  /** The proxy this worker has now (VPN tunnel or manual); undefined when it has none or the tunnel is down. */
  proxyUrl?: string | undefined;
}

export function chooseRoute({ url, route, proxyUrl }: RouteInput): RouteDecision {
  const mode = route ?? 'auto';
  const proxy = proxyUrl?.trim() || undefined;

  if (mode === 'direct') {
    return { via: 'direct', proxyUrl: undefined, reason: 'direct (the key says so)' };
  }

  if (mode === 'vpn') {
    if (!proxy) {
      throw new RouteUnavailableError(
        'This key requires the VPN, but this worker has none running (VPN is off or the tunnel is down) — turn it on in the worker settings, or change the key\'s route',
      );
    }

    return { via: 'vpn', proxyUrl: proxy, reason: 'through the worker\'s VPN (the key says so)' };
  }

  let hostname = '';

  try {
    hostname = new URL(url).hostname;
  } catch {
    // an unparsable address fails at fetch with a clearer message; treat it as public
  }

  if (hostname !== '' && isPrivateHost(hostname)) {
    return { via: 'direct', proxyUrl: undefined, reason: 'direct (a private address is not reachable through the VPN)' };
  }

  return proxy
    ? { via: 'vpn', proxyUrl: proxy, reason: 'through the worker\'s VPN' }
    : { via: 'direct', proxyUrl: undefined, reason: 'direct (the worker has no VPN)' };
}
