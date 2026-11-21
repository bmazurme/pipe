// The bridge's own tunnel (tunnel/bridge-tunnel.service.ts) publishes its HTTP proxy here while it works — verified against the services
// bridge needs, not merely listening — and what talks to Telegram or GitHub asks here before it picks a proxy. Module-level state, like
// github-dispatcher.ts: the services that use it must not depend on the module that runs the tunnel (the VPN module needs Telegram).

// The stack's static client (infra/bridge-pi/worker-pi.yml). Its configuration is fixed when the stack is deployed: it follows no
// connection of the VPN page, and when its exit dies nothing tells anyone.
export const STACK_PROXY_URL = 'http://vpn-client:1080';

let tunnel: string | null = null;

export function setTunnelProxy(url: string | null): void {
  tunnel = url;
}

export function tunnelProxyUrl(): string | undefined {
  return tunnel ?? undefined;
}

const sameUrl = (a: string, b: string) =>
  a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

// The proxy a caller should use, given the one it was configured with: unless the owner pointed it at some proxy of their own (stated
// otherwise), the connection that is active on the VPN page is used — through the bridge's own tunnel while that works. A caller with
// no proxy at all (a dev machine, GitHub reached directly) keeps going direct.
export function preferTunnel(
  configured: string | undefined,
): string | undefined {
  if (tunnel && configured && sameUrl(configured, STACK_PROXY_URL)) {
    return tunnel;
  }

  return configured;
}
