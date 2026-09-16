import { ProxyAgent, setGlobalDispatcher } from 'undici';

// Node's global `fetch` (undici) does not read HTTP_PROXY/HTTPS_PROXY on its
// own — without this, outbound calls to GitLab/bridge silently try to
// connect directly and hang until they time out on networks that require a
// proxy to reach the internet.
export function setupProxy() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;

  if (!proxyUrl) {
    return;
  }

  setGlobalDispatcher(new ProxyAgent(proxyUrl));

  const { protocol, host } = new URL(proxyUrl);

  console.log(`🌐 Исходящие запросы идут через прокси ${protocol}//${host}`);
}
