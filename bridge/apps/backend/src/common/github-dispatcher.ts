import { ProxyAgent, type Dispatcher } from 'undici';

// api.github.com is slow or unreachable from the production host at times (every request then ends in "The operation was aborted due to
// timeout": Improve runs, CI checks of pull requests, Lab). When GITHUB_PROXY_URL is set, the calls to GitHub go through that HTTP proxy —
// the stack's own vpn-client (http://vpn-client:1080), which Telegram already uses. Unset (the default) = direct, as before.
//
// Which proxy applies: what the owner chose in the Dashboard (kept in the database, set here by the settings service — on or off), and,
// while nothing was chosen, the GITHUB_PROXY_URL of the environment. Built once per URL — a ProxyAgent keeps its own connection pool.
let chosen: { enabled: boolean; url: string } | null = null;
let cached: { url: string; agent: ProxyAgent } | null = null;

// `null` = nothing chosen in the interface: the environment decides, as it did before the setting existed.
export function setGithubProxyChoice(
  choice: { enabled: boolean; url: string } | null,
): void {
  chosen = choice;
}

export function githubProxyUrl(): string | undefined {
  if (chosen) return chosen.enabled && chosen.url ? chosen.url : undefined;

  return process.env.GITHUB_PROXY_URL?.trim() || undefined;
}

export function githubDispatcher(): Dispatcher | undefined {
  const url = githubProxyUrl();

  if (!url) return undefined;

  if (cached?.url !== url) cached = { url, agent: new ProxyAgent(url) };

  return cached.agent;
}
