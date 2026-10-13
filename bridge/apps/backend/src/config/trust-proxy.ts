/**
 * Which hops Express trusts X-Forwarded-For from. 'loopback' fits a reverse proxy on the same host
 * (the original nginx deployment). Behind a proxy in another container — the Raspberry Pi stack puts
 * Caddy on the Swarm overlay network — set TRUST_PROXY to what Express accepts: 'uniquelocal'
 * (private ranges), a CIDR, or a comma-separated list. Anything else would lump every client into
 * the proxy's own address for ThrottlerGuard and the sessions list.
 */
export function resolveTrustProxy(
  value: string | undefined,
): string | string[] {
  const list = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (list.length === 0) {
    return 'loopback';
  }

  return list.length === 1 ? list[0] : list;
}
