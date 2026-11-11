import { EventEmitter } from 'node:events';
import { createServer, Server } from 'node:net';
import type * as tls from 'node:tls';

import { probeChannel } from './link-probe';

const CHANNEL = { host: '203.0.113.7', port: 443, sni: 'example.com' };

// A socket the test drives by hand: which events come, and when.
function fakeSocket() {
  const socket = new EventEmitter() as EventEmitter & { destroy: jest.Mock };

  socket.destroy = jest.fn();

  return socket;
}
const connectWith = (socket: unknown) =>
  (() => socket) as unknown as typeof tls.connect;

describe('probeChannel (driven sockets)', () => {
  it('is ok when the handshake completes, with the time to connect and the time for the handshake', async () => {
    const socket = fakeSocket();
    const done = probeChannel(CHANNEL, 1000, connectWith(socket));

    socket.emit('connect');
    await new Promise((r) => setTimeout(r, 15));
    socket.emit('secureConnect');
    const outcome = await done;

    expect(outcome.result).toBe('ok');
    expect(outcome.tcpMs).not.toBeNull();
    expect(outcome.tlsMs).toBeGreaterThanOrEqual(10);
    expect(outcome.detail).toBeNull();
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('is tcp_timeout when nothing answers the SYN within the time', async () => {
    const outcome = await probeChannel(CHANNEL, 30, connectWith(fakeSocket()));

    expect(outcome).toMatchObject({
      result: 'tcp_timeout',
      tcpMs: null,
      tlsMs: null,
    });
  });

  it('is tcp_refused for a reset on the SYN', async () => {
    const socket = fakeSocket();
    const done = probeChannel(CHANNEL, 1000, connectWith(socket));

    socket.emit(
      'error',
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    );

    await expect(done).resolves.toMatchObject({
      result: 'tcp_refused',
      detail: 'ECONNREFUSED',
    });
  });

  it('is tls_timeout when the connection is made and then nothing comes', async () => {
    const socket = fakeSocket();
    const done = probeChannel(CHANNEL, 40, connectWith(socket));

    socket.emit('connect');

    const outcome = await done;

    expect(outcome.result).toBe('tls_timeout');
    expect(outcome.tcpMs).not.toBeNull();
    expect(outcome.tlsMs).toBeNull();
  });

  it('is tls_reset for a reset after the connection was made (what DPI does)', async () => {
    const socket = fakeSocket();
    const done = probeChannel(CHANNEL, 1000, connectWith(socket));

    socket.emit('connect');
    socket.emit(
      'error',
      Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    );

    await expect(done).resolves.toMatchObject({
      result: 'tls_reset',
      detail: 'ECONNRESET',
    });
  });

  it('is tls_error when the peer closes during the handshake without a word', async () => {
    const socket = fakeSocket();
    const done = probeChannel(CHANNEL, 1000, connectWith(socket));

    socket.emit('connect');
    socket.emit('close');

    await expect(done).resolves.toMatchObject({ result: 'tls_error' });
  });

  it('answers once, whatever comes after', async () => {
    const socket = fakeSocket();
    const done = probeChannel(CHANNEL, 1000, connectWith(socket));

    socket.emit('connect');
    socket.emit('secureConnect');
    socket.emit('error', new Error('late'));
    socket.emit('close');

    await expect(done).resolves.toMatchObject({ result: 'ok' });
  });

  it('handshakes with the SNI of the link, not the address, and does not check the certificate', async () => {
    const connect = jest.fn(() => fakeSocket());

    void probeChannel(CHANNEL, 20, connect as unknown as typeof tls.connect);

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '203.0.113.7',
        port: 443,
        servername: 'example.com',
        rejectUnauthorized: false,
      }),
    );
  });
});

describe('probeChannel (real local sockets)', () => {
  let server: Server | undefined;
  let port: number;
  const accepted: import('node:net').Socket[] = [];

  // A server only closes once every accepted connection has: the silent ones are ended by hand.
  afterEach(async () => {
    accepted.splice(0).forEach((socket) => socket.destroy());

    if (server?.listening)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  const listen = async (
    handler: (socket: import('node:net').Socket) => void,
  ) => {
    const created = createServer((socket) => {
      accepted.push(socket);
      handler(socket);
    });

    server = created;
    await new Promise<void>((resolve) =>
      created.listen(0, '127.0.0.1', resolve),
    );
    port = (created.address() as { port: number }).port;
  };

  it('is tcp_refused for a port nothing listens on', async () => {
    await listen(() => undefined);
    const free = port;

    await new Promise<void>((resolve) => server?.close(() => resolve()));

    await expect(
      probeChannel({ host: '127.0.0.1', port: free, sni: 'example.com' }, 2000),
    ).resolves.toMatchObject({ result: 'tcp_refused' });
  });

  it('is a TLS failure, with the TCP time known, when the other end is not TLS at all', async () => {
    await listen((socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));

    const outcome = await probeChannel(
      { host: '127.0.0.1', port, sni: 'example.com' },
      2000,
    );

    expect(outcome.result).toMatch(/^tls_/);
    expect(outcome.tcpMs).not.toBeNull();
  });

  it('is tls_timeout for a server that accepts and says nothing', async () => {
    await listen(() => undefined);

    await expect(
      probeChannel({ host: '127.0.0.1', port, sni: 'example.com' }, 300),
    ).resolves.toMatchObject({ result: 'tls_timeout' });
  });
});
