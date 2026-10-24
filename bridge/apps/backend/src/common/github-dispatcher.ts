import { ProxyAgent, type Dispatcher } from 'undici';

// api.github.com is slow or unreachable from the production host at times (every request then ends in "The operation was aborted due to
// timeout": Improve runs, CI checks of pull requests, Lab). When GITHUB_PROXY_URL is set, the calls to GitHub go through that HTTP proxy —
// the stack's own vpn-client (http://vpn-client:1080), which Telegram already uses. Unset (the default) = direct, as before.
//
// Built once per URL — a ProxyAgent keeps its own connection pool. `dispatcher` is a Node/undici extension of fetch that is real at
// runtime and absent from the standard RequestInit type, so callers pass `{ dispatcher: githubDispatcher() } as RequestInit`.
let cached: { url: string; agent: ProxyAgent } | null = null;

export function githubDispatcher(): Dispatcher | undefined {
  const url = process.env.GITHUB_PROXY_URL?.trim();

  if (!url) return undefined;

  if (cached?.url !== url) cached = { url, agent: new ProxyAgent(url) };

  return cached.agent;
}
