const CERT_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
]);

// undici wraps the real reason several `cause`s deep (fetch failed → DOMException → RequestAbortedError).
function causeChain(error: unknown): { code?: string; message?: string }[] {
  const chain: { code?: string; message?: string }[] = [];
  let current: unknown = error;

  for (let depth = 0; current && typeof current === 'object' && depth < 6; depth++) {
    chain.push(current as { code?: string; message?: string });
    current = (current as { cause?: unknown }).cause;
  }

  return chain;
}

export function describeFetchError(error: unknown, url: string | URL): Error {
  const host = typeof url === 'string' ? new URL(url).host : url.host;

  if (error instanceof Error && error.name === 'TimeoutError') {
    return new Error(`Нет ответа от ${host}: время ожидания вышло. Проверьте доступность хоста с этой машины (сеть, VPN, прокси, файрвол).`);
  }

  if (error instanceof TypeError && error.message === 'fetch failed') {
    const chain = causeChain(error.cause);
    const proxy = chain.map((e) => /Proxy response \((\d+)\)/.exec(e.message ?? '')).find(Boolean);

    if (proxy) {
      return new Error(
        `Прокси отклонил соединение с ${host} (ответ ${proxy[1]}). Если ${host} во внутренней сети, добавьте его в NO_PROXY в packages/server/.env (например NO_PROXY=${host.replace(/:\d+$/, '')}); иначе попросите администратора разрешить этот хост на прокси.`,
      );
    }

    const code = chain.map((e) => e.code).find(Boolean);

    if (code === 'UND_ERR_CONNECT_TIMEOUT') {
      return new Error(`Не удалось подключиться к ${host}: сервер не отвечает (таймаут соединения). Проверьте доступность хоста с этой машины (сеть, VPN, прокси, файрвол).`);
    }

    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return new Error(`Не удалось подключиться к ${host}: хост не найден (ошибка DNS).`);
    }

    if (code === 'ECONNREFUSED') {
      return new Error(`Не удалось подключиться к ${host}: соединение отклонено.`);
    }

    if (code && CERT_CODES.has(code)) {
      return new Error(`Не удалось подключиться к ${host}: сертификат сервера не принят (${code}). Укажите корпоративный сертификат через NODE_EXTRA_CA_CERTS=путь/к/ca.pem.`);
    }

    return new Error(`Не удалось подключиться к ${host}${code ? ` (${code})` : ''}.`);
  }

  return error instanceof Error ? error : new Error('Unknown error');
}
