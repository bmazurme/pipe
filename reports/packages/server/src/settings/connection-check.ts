import type { ConnectionCheckItemType, ConnectionCheckResultType, ConnectionCheckTarget, SettingsType } from '@reports/shared';

import { describeFetchError } from '../utils/describe-fetch-error';

const CHECK_TIMEOUT_MS = 10_000;
const GITHUB_API = 'https://api.github.com';

type Status = ConnectionCheckItemType['status'];

const item = (label: string, status: Status, message: string): ConnectionCheckItemType => ({ label, status, message });

// error > warn > ok > skip: one verdict for the whole card.
function worst(items: ConnectionCheckItemType[]): Status {
  for (const status of ['error', 'warn', 'ok'] as const) {
    if (items.some((entry) => entry.status === status)) return status;
  }

  return 'skip';
}

async function timed(url: string, init: RequestInit): Promise<{ response: Response; ms: number }> {
  const started = Date.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) }).catch((error) => {
    throw describeFetchError(error, url);
  });

  return { response, ms: Date.now() - started };
}

async function errorBody(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
  const message = body?.message ?? body?.error;

  if (Array.isArray(message)) return message.join('; ');

  return typeof message === 'string' ? message : '';
}

function failure(label: string, error: unknown): ConnectionCheckItemType[] {
  return [item(label, 'error', error instanceof Error ? error.message : 'Неизвестная ошибка')];
}

export async function checkGitlab(settings: SettingsType): Promise<ConnectionCheckItemType[]> {
  const base = settings.gitlabUrl.trim().replace(/\/+$/, '');

  if (!base) return [item('GitLab', 'error', 'Не указан GitLab URL')];
  if (!settings.privateToken) return [item('GitLab', 'error', 'Не указан токен доступа')];

  try {
    new URL(base);
  } catch {
    return [item('GitLab', 'error', 'GitLab URL не похож на адрес: ожидается вид https://gitlab.example.com/api/v4')];
  }

  const items: ConnectionCheckItemType[] = [];

  try {
    const { response, ms } = await timed(`${base}/user`, { headers: { 'Private-Token': settings.privateToken } });

    if (response.status === 401) {
      return [item('GitLab', 'error', 'Токен отклонён (401): он неверный, отозван или истёк')];
    }

    if (response.status === 403) {
      return [item('GitLab', 'error', 'Доступ запрещён (403): у токена нет нужных прав (нужен read_api) или IP закрыт правилами GitLab')];
    }

    if (response.status === 404) {
      return [item('GitLab', 'error', 'Адрес не похож на GitLab API (404): URL должен заканчиваться на /api/v4')];
    }

    if (!response.ok) {
      const detail = await errorBody(response);

      return [item('GitLab', 'error', `GitLab ответил ${response.status}${detail ? `: ${detail}` : ''}`)];
    }

    const user = (await response.json().catch(() => null)) as { id?: number; username?: string; name?: string } | null;

    if (!user || typeof user.id !== 'number') {
      return [item('GitLab', 'error', 'Ответ не похож на GitLab API: проверьте, что URL ведёт на /api/v4, а не на страницу входа')];
    }

    items.push(item('GitLab', 'ok', `Подключено как @${user.username ?? user.id}${user.name ? ` (${user.name})` : ''}, ${ms} мс`));

    const configuredId = settings.userId.trim();

    if (!configuredId) {
      items.push(item('ID пользователя', 'skip', `Не указан; у этого токена ID ${user.id}`));
    } else if (configuredId !== String(user.id)) {
      items.push(item('ID пользователя', 'warn', `В настройках ${configuredId}, а токен принадлежит пользователю с ID ${user.id}: отчёт покажет задачи другого человека`));
    } else {
      items.push(item('ID пользователя', 'ok', `Совпадает с владельцем токена (${user.id})`));
    }
  } catch (error) {
    return failure('GitLab', error);
  }

  return items;
}

// The token is deliberately not a Setting (settings.json travels in export bundles), so this
// checks the one in the server's environment — the same one the Subscription module uses.
export async function checkGithub(_settings: SettingsType, token = process.env.GITHUB_TOKEN): Promise<ConnectionCheckItemType[]> {
  if (!token) {
    return [item('GitHub', 'skip', 'GITHUB_TOKEN не задан в packages/server/.env — нужен только для отслеживания GitHub-репозиториев')];
  }

  try {
    const { response, ms } = await timed(`${GITHUB_API}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      return [item('GitHub', 'error', 'GITHUB_TOKEN отклонён (401): токен неверный, отозван или истёк')];
    }

    if (!response.ok) {
      const detail = await errorBody(response);

      return [item('GitHub', 'error', `GitHub ответил ${response.status}${detail ? `: ${detail}` : ''}`)];
    }

    const user = (await response.json().catch(() => null)) as { login?: string } | null;
    const items = [item('GitHub', 'ok', `Подключено${user?.login ? ` как ${user.login}` : ''}, ${ms} мс`)];
    const remaining = response.headers.get('x-ratelimit-remaining');

    if (remaining !== null && Number(remaining) < 50) {
      items.push(item('Лимит запросов', 'warn', `Осталось ${remaining} запросов в этот час`));
    }

    return items;
  } catch (error) {
    return failure('GitHub', error);
  }
}

// Reachability first (no key needed), then each key on its own: a rejected key and an
// unreachable server need different fixes, so they are reported separately.
export async function checkBridge(settings: SettingsType): Promise<ConnectionCheckItemType[]> {
  const raw = settings.bridgeApiUrl.trim();

  if (!raw) return [item('Bridge', 'skip', 'Bridge API URL не указан — интеграция с bridge выключена')];

  let origin: string;

  try {
    origin = new URL(raw).origin;
  } catch {
    return [item('Bridge', 'error', 'Bridge API URL не похож на адрес: ожидается вид https://bridge.example.com/api/v1/time')];
  }

  const items: ConnectionCheckItemType[] = [];

  try {
    const { response, ms } = await timed(`${origin}/api/v1/health`, {});

    if (response.ok) {
      items.push(item('Bridge', 'ok', `Доступен, ${ms} мс`));
    } else if (response.status === 404) {
      items.push(item('Bridge', 'warn', `Сервер отвечает, но /api/v1/health не найден (${ms} мс): проверьте, что адрес ведёт на bridge`));
    } else {
      return [item('Bridge', 'error', `Bridge отвечает, но не готов (health ${response.status}): база недоступна или идёт обновление`)];
    }
  } catch (error) {
    return failure('Bridge', error);
  }

  const keys: { label: string; value: string; header: (value: string) => Record<string, string> }[] = [
    { label: 'Bridge API key', value: settings.bridgeApiKey, header: (value) => ({ 'X-Api-Key': value }) },
    { label: 'Storage API key', value: settings.bridgeStorageApiKey, header: (value) => ({ Authorization: `Bearer ${value}` }) },
  ];

  for (const key of keys) {
    if (!key.value) {
      items.push(item(key.label, 'skip', 'Не указан'));
      continue;
    }

    try {
      // A light route behind the same guard as Storage/time; only the status is read, never the payload.
      const { response } = await timed(`${origin}/api/v1/reports-settings`, { headers: key.header(key.value) });

      if (response.status === 401 || response.status === 403) {
        items.push(item(key.label, 'error', `Ключ отклонён (${response.status}): он неверный или отозван — создайте новый в bridge (Профиль → API-ключи)`));
      } else if (response.ok) {
        items.push(item(key.label, 'ok', 'Принят'));
      } else {
        items.push(item(key.label, 'error', `Bridge ответил ${response.status}`));
      }
    } catch (error) {
      items.push(...failure(key.label, error));
    }
  }

  return items;
}

export async function runConnectionCheck(target: ConnectionCheckTarget, settings: SettingsType): Promise<ConnectionCheckResultType> {
  const started = Date.now();
  const items = await { gitlab: checkGitlab, github: checkGithub, bridge: checkBridge }[target](settings);

  return { target, status: worst(items), items, ms: Date.now() - started };
}

export function isConnectionCheckTarget(value: unknown): value is ConnectionCheckTarget {
  return value === 'gitlab' || value === 'github' || value === 'bridge';
}
