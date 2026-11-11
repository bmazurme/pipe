import { BadGatewayException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import { createServer, Server } from 'node:net';

import {
  MAX_SUBSCRIPTION_BYTES,
  SubscriptionService,
} from './subscription.service';

// createConnection is wrapped so one test can hand the service a socket that never answers; the others use the real one.
jest.mock('node:net', () => {
  const actual = jest.requireActual<typeof import('node:net')>('node:net');

  return { ...actual, createConnection: jest.fn(actual.createConnection) };
});

const LINK =
  'vless://11111111-2222-3333-4444-555555555555@203.0.113.9:443?type=tcp&security=reality&encryption=none&flow=xtls-rprx-vision&fp=firefox&sni=example.com&sid=&pbk=PUBKEY#remark';
const URL_WITH_TOKEN =
  'https://api.provider.example/sub/SECRET-TOKEN-123#PaperVPN';

const text = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, ...init });

describe('SubscriptionService.resolve', () => {
  const service = new SubscriptionService();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('fetches the address and hands back the first usable link with its server', async () => {
    fetchMock.mockResolvedValue(text(`vmess://x\n${LINK}\n`));

    const result = await service.resolve(URL_WITH_TOKEN, 'PaperVPN');

    expect(result).toMatchObject({
      link: LINK,
      host: '203.0.113.9',
      port: 443,
      unsupported: 1,
    });
    expect(result.links).toEqual([LINK]);
    const [url, init] = fetchMock.mock.calls[0];

    expect(String(url)).toContain('api.provider.example/sub/SECRET-TOKEN-123');
    expect(init).toMatchObject({ redirect: 'manual' });
    expect(init.headers['User-Agent']).toBe('pipe-bridge');
  });

  it('follows a redirect to another public https address', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.provider.example/list' },
        }),
      )
      .mockResolvedValueOnce(text(LINK));

    await expect(service.resolve(URL_WITH_TOKEN)).resolves.toMatchObject({
      link: LINK,
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://cdn.provider.example/list',
    );
  });

  it.each([
    ['plain http', 'http://cdn.provider.example/list'],
    ['a private address', 'https://192.168.50.11/list'],
    ['localhost', 'https://localhost/list'],
  ])('refuses a redirect to %s', async (_label, location) => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location } }),
    );

    await expect(service.resolve(URL_WITH_TOKEN, 'PaperVPN')).rejects.toThrow(
      /перенаправляет не туда/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up on a loop of redirects', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://p.example/again' },
        }),
    );

    await expect(service.resolve(URL_WITH_TOKEN)).rejects.toThrow(
      /слишком много перенаправлений/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('refuses an address that is not a public https one without asking the network', async () => {
    await expect(
      service.resolve('http://api.provider.example/sub', 'A'),
    ).rejects.toThrow(/https/);
    await expect(service.resolve('https://127.0.0.1/sub', 'A')).rejects.toThrow(
      /внутреннюю сеть/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [403, /отклонила запрос \(403\)/],
    [401, /отклонила запрос \(401\)/],
    [500, /ответила 500/],
  ])('reports a %i answer', async (status, message) => {
    fetchMock.mockResolvedValue(text('no', { status }));

    await expect(service.resolve(URL_WITH_TOKEN, 'PaperVPN')).rejects.toThrow(
      message,
    );
  });

  it('reports a timeout and a network failure with their reason', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('t'), { name: 'TimeoutError' }),
    );
    await expect(service.resolve(URL_WITH_TOKEN, 'PaperVPN')).rejects.toThrow(
      /не ответила за 10000 мс/,
    );

    fetchMock.mockRejectedValueOnce(
      Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND' },
      }),
    );
    await expect(service.resolve(URL_WITH_TOKEN, 'PaperVPN')).rejects.toThrow(
      /недоступна из bridge \(ENOTFOUND\)/,
    );
  });

  it('refuses an answer that is too big, declared or not', async () => {
    fetchMock.mockResolvedValueOnce(
      text('x', {
        headers: { 'content-length': String(MAX_SUBSCRIPTION_BYTES + 1) },
      }),
    );
    await expect(service.resolve(URL_WITH_TOKEN, 'A')).rejects.toThrow(
      /слишком большой/,
    );

    fetchMock.mockResolvedValueOnce(
      text('x'.repeat(MAX_SUBSCRIPTION_BYTES + 1)),
    );
    await expect(service.resolve(URL_WITH_TOKEN, 'A')).rejects.toThrow(
      /слишком большой/,
    );
  });

  it('says what is wrong when the list has nothing a tunnel can run', async () => {
    fetchMock.mockResolvedValue(text('vmess://a\ntrojan://b\n'));

    const error = await service
      .resolve(URL_WITH_TOKEN, 'PaperVPN')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).toMatch(
      /нет ссылки, с которой можно поднять туннель.*других ссылок: 2/,
    );
  });

  it("never puts the address (it carries the owner's token) into an error", async () => {
    const failures: Array<() => void> = [
      () => fetchMock.mockResolvedValueOnce(text('no', { status: 403 })),
      () => fetchMock.mockResolvedValueOnce(text('vmess://a')),
      () =>
        fetchMock.mockRejectedValueOnce(
          Object.assign(new TypeError('x'), { cause: { code: 'ECONNRESET' } }),
        ),
      () =>
        fetchMock.mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: 'https://127.0.0.1/x' },
          }),
        ),
    ];

    for (const arrange of failures) {
      arrange();
      const error = (await service
        .resolve(URL_WITH_TOKEN, 'PaperVPN')
        .catch((e: unknown) => e)) as Error;

      expect(error.message).not.toContain('SECRET-TOKEN-123');
      expect(error.message).not.toContain('api.provider.example');
    }
  });
});

describe('SubscriptionService.probe', () => {
  const service = new SubscriptionService();
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('succeeds when something accepts the connection', async () => {
    await expect(service.probe('127.0.0.1', port)).resolves.toBeUndefined();
  });

  it('fails with the error code when nothing listens', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const freePort = (closed.address() as { port: number }).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    await expect(service.probe('127.0.0.1', freePort)).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });

  it('fails with ETIMEDOUT when the socket stays silent for the whole time', async () => {
    // A real silent host cannot be had on every network (a local tunnel client accepts any connect), so the socket is a stand-in.
    const socket = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, onTimeout: () => void) => void;
      destroy: jest.Mock;
    };
    socket.destroy = jest.fn();
    socket.setTimeout = (ms, onTimeout) => void setTimeout(onTimeout, 5);
    (net.createConnection as jest.Mock).mockReturnValueOnce(socket);

    await expect(service.probe('203.0.113.1', 443, 1234)).rejects.toMatchObject(
      { code: 'ETIMEDOUT' },
    );
    expect(socket.destroy).toHaveBeenCalled();
  });
});
