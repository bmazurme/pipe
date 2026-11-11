// Delivery of a digest to notes.ntlstl.dev as a DRAFT. notes-core accepts it on `POST /api/v1/notes/drafts` with a key
// (NOTES_INGEST_KEY on that side) and always saves it unpublished; the owner publishes from the editor.

import { isIP } from 'node:net';

import type { DigestNote } from './lab-digest';

export const DEFAULT_NOTES_URL = 'https://notes.ntlstl.dev';
export const NOTES_KEY_MIN_LENGTH = 32;
export const NOTES_KEY_MAX_LENGTH = 200;

// notes-core reads a JSON body of at most 100 KB (express' default); stay clear of it.
const MAX_BODY_BYTES = 90_000;
const TIMEOUT_MS = 15_000;

// 'config' — something the owner can fix in the settings or in the text; 'remote' — the site did not take it now.
export class NotesSendError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'remote',
  ) {
    super(message);
  }
}

// The site's origin only, https only. The address is typed in by the owner and fetched by bridge, so a bare IP address,
// localhost, a name without a dot and credentials in the URL are refused: it cannot be pointed at bridge's own network.
export function normalizeNotesUrl(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    throw new NotesSendError('Адрес notes: ожидается https://хост', 'config');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (url.protocol !== 'https:') {
    throw new NotesSendError('Адрес notes: только https', 'config');
  }

  if (url.username || url.password) {
    throw new NotesSendError('Адрес notes: без логина и пароля', 'config');
  }

  if (
    isIP(host) !== 0 ||
    host === 'localhost' ||
    !host.includes('.') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new NotesSendError(
      'Адрес notes: нужно доменное имя сайта, не IP-адрес и не локальное имя',
      'config',
    );
  }

  return url.origin;
}

export interface SentDraft {
  id: number;
  slug: string | null;
}

interface SendInput {
  baseUrl: string;
  key: string;
  typeName: string;
  note: DigestNote;
  fetchFn?: typeof fetch;
}

async function call(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchFn(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NotesSendError(
      'Сайт notes не ответил (нет связи или ответ слишком долгий) — попробуйте позже',
      'remote',
    );
  }
}

async function serverMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };

    if (Array.isArray(body.message)) return body.message.join('; ');
    if (typeof body.message === 'string') return body.message;
  } catch {
    // no JSON body
  }

  return '';
}

// Finds the type by name on the site (the ids are the site's own), then creates the draft.
export async function sendDraft(input: SendInput): Promise<SentDraft> {
  const fetchFn = input.fetchFn ?? fetch;
  const typesResponse = await call(fetchFn, `${input.baseUrl}/api/v1/types`, {
    headers: { accept: 'application/json' },
  });

  if (!typesResponse.ok) {
    throw new NotesSendError(
      `Сайт notes не отдал список типов заметок (HTTP ${typesResponse.status})`,
      'remote',
    );
  }

  const types = (await typesResponse.json().catch(() => null)) as
    { id?: unknown; name?: unknown }[] | null;
  const type = Array.isArray(types)
    ? types.find(
        (entry) =>
          typeof entry.name === 'string' &&
          entry.name.toLowerCase() === input.typeName.toLowerCase() &&
          typeof entry.id === 'number',
      )
    : undefined;

  if (!type) {
    throw new NotesSendError(
      `На сайте notes нет типа «${input.typeName}» — создайте его в разделе типов`,
      'config',
    );
  }

  const body = JSON.stringify({
    title: input.note.title,
    preview: input.note.preview,
    content: input.note.content,
    tags: input.note.tags,
    type: { id: type.id },
  });

  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    throw new NotesSendError(
      'Заметка слишком большая для отправки (больше 90 КБ) — сократите текст',
      'config',
    );
  }

  const response = await call(fetchFn, `${input.baseUrl}/api/v1/notes/drafts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.key}`,
    },
    body,
  });

  if (response.status === 404) {
    throw new NotesSendError(
      'Сайт notes не принимает черновики: на нём не задан NOTES_INGEST_KEY или не выложена версия с POST /notes/drafts',
      'config',
    );
  }

  if (response.status === 401) {
    throw new NotesSendError(
      'Сайт notes не принял ключ — проверьте ключ в настройках дайджеста',
      'config',
    );
  }

  if (response.status === 503) {
    throw new NotesSendError(
      `Сайт notes: ${(await serverMessage(response)) || 'автор черновиков не найден — войдите на сайт хотя бы раз'}`,
      'config',
    );
  }

  if (response.status === 400) {
    throw new NotesSendError(
      `Сайт notes отклонил заметку: ${(await serverMessage(response)) || 'неверные данные'}`,
      'config',
    );
  }

  if (!response.ok) {
    throw new NotesSendError(
      `Сайт notes ответил ошибкой (HTTP ${response.status})`,
      'remote',
    );
  }

  const created = (await response.json().catch(() => null)) as {
    id?: unknown;
    slug?: unknown;
  } | null;

  if (!created || typeof created.id !== 'number') {
    throw new NotesSendError(
      'Сайт notes ответил без номера заметки — проверьте черновики на сайте вручную',
      'remote',
    );
  }

  return {
    id: created.id,
    slug: typeof created.slug === 'string' ? created.slug : null,
  };
}
