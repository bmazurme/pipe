export function describeFetchError(error: unknown, url: string | URL): Error {
  const host = typeof url === 'string' ? new URL(url).host : url.host;

  if (error instanceof TypeError && error.message === 'fetch failed') {
    const code = (error.cause as { code?: string } | undefined)?.code;

    if (code === 'UND_ERR_CONNECT_TIMEOUT') {
      return new Error(`Не удалось подключиться к ${host}: сервер не отвечает (таймаут соединения). Проверьте доступность хоста с этой машины (сеть, VPN, прокси, файрвол).`);
    }

    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return new Error(`Не удалось подключиться к ${host}: хост не найден (ошибка DNS).`);
    }

    if (code === 'ECONNREFUSED') {
      return new Error(`Не удалось подключиться к ${host}: соединение отклонено.`);
    }

    return new Error(`Не удалось подключиться к ${host}${code ? ` (${code})` : ''}.`);
  }

  return error instanceof Error ? error : new Error('Unknown error');
}
