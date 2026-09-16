/** Turns any RTK Query / fetch failure into a message that makes sense to a person. */
export const describeError = (error: unknown, fallback = 'Что-то пошло не так'): string => {
  if (!error) {
    return fallback;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object') {
    const candidate = error as Record<string, unknown>;

    if (typeof candidate.message === 'string' && candidate.message) {
      return candidate.message;
    }

    if (candidate.status === 'FETCH_ERROR') {
      return 'Сервер недоступен. Проверьте, что бэкенд запущен на ' + (import.meta.env.VITE_API_DOMAIN || 'http://localhost:4000/api');
    }

    if (typeof candidate.status === 'number') {
      return `Ошибка запроса (HTTP ${candidate.status})`;
    }

    if (typeof candidate.error === 'string' && candidate.error) {
      return candidate.error;
    }
  }

  return fallback;
};
