import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

export interface SetupProxyOptions {
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

// Node's global `fetch` (undici) does not read HTTP_PROXY/HTTPS_PROXY on its
// own — without this, outbound calls silently try to connect directly and
// hang until they time out on networks that require a proxy to reach the
// internet. Returns the proxy URL it applied, or undefined if none is set.
// NO_PROXY / no_proxy (comma-separated hosts, `.suffix`, `*`, optional :port)
// lists destinations that must bypass the proxy — typically an intranet GitLab
// that a corporate proxy refuses to tunnel to (403 on CONNECT).
export function setupProxy(opts: SetupProxyOptions = {}): string | undefined {
  const env = opts.env ?? process.env;
  const log = opts.log ?? console.log;
  const proxyUrl = env.HTTPS_PROXY || env.https_proxy
    || env.HTTP_PROXY || env.http_proxy;

  if (!proxyUrl) {
    return undefined;
  }

  setGlobalDispatcher(new EnvHttpProxyAgent({
    httpProxy: proxyUrl,
    httpsProxy: proxyUrl,
    noProxy: env.NO_PROXY ?? env.no_proxy ?? '',
  }));

  // Only protocol//host: the URL may carry credentials.
  const { protocol, host } = new URL(proxyUrl);
  log(`🌐 Исходящие запросы идут через прокси ${protocol}//${host}`);
  return proxyUrl;
}
