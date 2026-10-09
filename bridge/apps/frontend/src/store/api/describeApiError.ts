// A one-line, human reason for a failed request — so a generic "could not load" says whether
// the session expired, the server pushed back (429), the server could not be reached, or what
// the server itself answered. Never includes request data.
export function describeApiError(error: unknown): string {
  if (typeof error === 'string' && error) return error;

  if (!error || typeof error !== 'object') return 'неизвестная ошибка';

  const { status, data, error: detail } = error as { status?: unknown; data?: unknown; error?: unknown };

  if (status === 'FETCH_ERROR') return 'нет связи с сервером';
  if (status === 'TIMEOUT_ERROR') return 'сервер не ответил вовремя';
  if (status === 'PARSING_ERROR') return 'сервер вернул непонятный ответ';
  if (status === 'CUSTOM_ERROR' && typeof detail === 'string') return detail;

  const message = (data as { message?: string | string[] } | undefined)?.message;
  const text = Array.isArray(message) ? message.join(', ') : message;

  if (status === 401) return 'сеанс истёк — войдите заново';
  if (status === 429) return 'слишком много запросов (HTTP 429) — подождите минуту';
  if (typeof status === 'number') return text ? `${text} (HTTP ${status})` : `HTTP ${status}`;

  return text ?? 'неизвестная ошибка';
}
