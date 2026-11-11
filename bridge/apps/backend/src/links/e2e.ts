// End-to-end checks: not "does the VPN server accept a connection" (what a channel probe says) but "does a request go THROUGH the
// tunnel to the service we need". A worker makes them through its own tunnel (worker/src/tunnelProbe.ts) and reports under its name;
// the keys and labels below are the shared vocabulary (the worker carries the same list).

export interface E2eTarget {
  key: string;
  label: string;
  url: string;
  /** Down from every worker means the work this target stands for cannot be done at all. */
  critical: boolean;
}

export const E2E_TARGETS: E2eTarget[] = [
  {
    key: 'e2e:claude',
    label: 'Claude API',
    url: 'https://api.anthropic.com/',
    critical: true,
  },
  {
    key: 'e2e:telegram',
    label: 'Telegram API',
    url: 'https://api.telegram.org/',
    critical: false,
  },
  {
    key: 'e2e:github',
    label: 'GitHub API',
    url: 'https://api.github.com/',
    critical: false,
  },
];

export const E2E_PREFIX = 'e2e:';

export const isE2eKey = (key: string) => key.startsWith(E2E_PREFIX);

export const e2eTarget = (key: string): E2eTarget | undefined =>
  E2E_TARGETS.find((target) => target.key === key);

// What a result means for a request through a tunnel (the probe results are shared with the channel probes).
export const E2E_RESULT_TEXT: Record<string, string> = {
  ok: 'запрос проходит',
  tcp_timeout: 'нет ответа',
  tcp_refused: 'туннель не принимает соединения',
  tls_timeout: 'запрос завис (тротлинг?)',
  tls_reset: 'соединение сброшено',
  tls_error: 'ошибка TLS',
  error: 'ошибка запроса',
};
