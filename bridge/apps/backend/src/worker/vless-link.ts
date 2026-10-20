// The VPN of one worker is a vless:// Reality link (what an x-ui panel or a VPN app gives out). Bridge keeps it
// encrypted and hands it only to that worker, which runs its own Xray tunnel with it. This only checks that the link is
// one the worker can actually use — the same shape infra/bridge-pi/vless-to-xray.sh accepts (tcp + Reality).
export interface VlessSummary {
  host: string;
  port: number;
}

export function parseVlessLink(raw: string): VlessSummary {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('это не ссылка vless://UUID@хост:порт?…');
  }

  if (url.protocol !== 'vless:' || !url.hostname || !url.username) {
    throw new Error('нужна ссылка vless://UUID@хост:порт?…');
  }

  const query = url.searchParams;

  if (query.get('security') !== 'reality') {
    throw new Error('поддерживается только security=reality');
  }

  if ((query.get('type') ?? 'tcp') !== 'tcp') {
    throw new Error(
      `транспорт «${query.get('type')}» не поддерживается — только tcp`,
    );
  }

  for (const key of ['pbk', 'sni']) {
    if (!query.get(key)) {
      throw new Error(
        `в ссылке нет «${key}» — это должна быть полная Reality-ссылка (pbk, sni, fp, sid)`,
      );
    }
  }

  return { host: url.hostname, port: Number(url.port) || 443 };
}

// "host:port" for display, or null when there is no (valid) link.
export function describeVless(raw: string | null | undefined): string | null {
  if (!raw) return null;

  try {
    const { host, port } = parseVlessLink(raw);

    return `${host}:${port}`;
  } catch {
    return null;
  }
}

function proxyWithUserinfo(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());

    return url.username || url.password ? url : null;
  } catch {
    return null;
  }
}

export function proxyHasCredentials(raw: string | null | undefined): boolean {
  return !!raw && proxyWithUserinfo(raw) !== null;
}

// The proxy URL for owner views: user:pass@ becomes ***@, a URL without credentials is returned as it is.
export function maskProxyUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = proxyWithUserinfo(raw);

  if (!url) return raw;

  return `${url.protocol}//***@${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
}
