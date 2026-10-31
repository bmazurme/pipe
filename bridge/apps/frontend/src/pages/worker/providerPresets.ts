import type { ProviderAuthScheme, ProviderRoute } from '../../store/api';

// Templates for a "custom" key: they only fill the form in. Everything is editable, and the server stores what is in the form,
// not the template. Addresses and model formats of outside services change — check them against the service's own docs.
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  /** A hint for the model field. */
  modelHint: string;
  authScheme: ProviderAuthScheme;
  route: ProviderRoute;
  /** Header name → hint for its value (the value is the owner's own, e.g. a folder id). */
  headerHints: Record<string, string>;
  /** Where the content of jobs and chats goes when this key is used. */
  dataGoesTo: string;
  note: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'yandex',
    label: 'Yandex AI Studio',
    baseUrl: 'https://llm.api.cloud.yandex.net/v1',
    modelHint: 'gpt://<id каталога>/<модель>',
    authScheme: 'api-key',
    route: 'direct',
    headerHints: { 'x-folder-id': 'id каталога Yandex Cloud' },
    dataGoesTo: 'Yandex Cloud',
    note: 'Ключ — API-ключ сервисного аккаунта. Формат адреса и названия модели сверьте с документацией Yandex AI Studio.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelHint: 'gemini-2.5-pro',
    authScheme: 'bearer',
    route: 'vpn',
    headerHints: {},
    dataGoesTo: 'Google',
    note: 'Из России без VPN часто недоступен, поэтому маршрут «через VPN»: worker без VPN задачу не возьмёт. Адрес и модель сверьте с документацией Gemini API.',
  },
  {
    id: 'ollama',
    label: 'Ollama (локально)',
    baseUrl: 'http://localhost:11434/v1',
    modelHint: 'qwen2.5-coder:7b',
    authScheme: 'none',
    route: 'direct',
    headerHints: {},
    dataGoesTo: 'только ваша сеть',
    note: 'Адрес — машина с Ollama, как её видит worker (для worker на том же Mac — localhost). Для задач нужна модель с вызовом функций.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (локально)',
    baseUrl: 'http://localhost:1234/v1',
    modelHint: 'имя модели из LM Studio',
    authScheme: 'none',
    route: 'direct',
    headerHints: {},
    dataGoesTo: 'только ваша сеть',
    note: 'Включите локальный сервер в LM Studio; для доступа с других машин — слушать на всех интерфейсах.',
  },
  {
    id: 'other',
    label: 'Другой OpenAI-совместимый',
    baseUrl: '',
    modelHint: 'название модели',
    authScheme: 'bearer',
    route: 'auto',
    headerHints: {},
    dataGoesTo: 'на указанный сервер',
    note: 'Любой сервер с /chat/completions: llama.cpp, vLLM, шлюз вроде LiteLLM.',
  },
];

export function presetById(id: string | null | undefined): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

// "name: value" per line → headers. A line without a colon, with an empty name or value is reported, not guessed at.
export function parseHeaderLines(text: string): { headers: Record<string, string>; invalid: string[] } {
  const headers: Record<string, string> = {};
  const invalid: string[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();

    if (line === '') continue;

    const colon = line.indexOf(':');
    const name = colon > 0 ? line.slice(0, colon).trim() : '';
    const value = colon > 0 ? line.slice(colon + 1).trim() : '';

    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || value === '') invalid.push(line);
    else headers[name] = value;
  }

  return { headers, invalid };
}

const ROUTE_LABEL: Record<ProviderRoute, string> = {
  auto: 'авто (частные адреса напрямую, остальные через VPN worker\'а, если он есть)',
  vpn: 'всегда через VPN worker\'а',
  direct: 'всегда напрямую',
};

export const ROUTE_OPTIONS = (Object.keys(ROUTE_LABEL) as ProviderRoute[]).map((value) => ({ value, content: ROUTE_LABEL[value] }));

export const AUTH_OPTIONS: { value: ProviderAuthScheme; content: string }[] = [
  { value: 'bearer', content: 'Authorization: Bearer <ключ>' },
  { value: 'api-key', content: 'Authorization: Api-Key <ключ> (Yandex Cloud)' },
  { value: 'none', content: 'без ключа (локальный сервер)' },
];

/** One line for the list: where the key points and how its requests travel. */
export function describeKey(key: {
  provider: string;
  route: ProviderRoute;
  authScheme: ProviderAuthScheme;
  supportsTools: boolean;
  stream?: boolean;
  timeoutSec: number | null;
  allowedWorkerIds: number[] | null;
}): string {
  if (key.provider !== 'custom') return '';

  return [
    key.route === 'auto' ? 'маршрут: авто' : key.route === 'vpn' ? 'через VPN' : 'напрямую',
    key.authScheme === 'none' ? 'без ключа' : key.authScheme === 'api-key' ? 'Api-Key' : null,
    key.supportsTools ? null : 'без вызова функций (только чат)',
    key.stream ? 'потоком в чате' : null,
    key.timeoutSec ? `таймаут ${key.timeoutSec} с` : null,
    key.allowedWorkerIds?.length ? `только worker: ${key.allowedWorkerIds.length}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
