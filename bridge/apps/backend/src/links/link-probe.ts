import * as tls from 'node:tls';

import { Channel, classifyFailure, ProbeResult } from './links';

export const PROBE_TIMEOUT_MS = 6_000;

export interface ProbeOutcome {
  result: ProbeResult;
  tcpMs: number | null;
  tlsMs: number | null;
  detail: string | null;
}

// One connection to a channel as a client would make it: TCP to host:port, then a TLS handshake with the link's SNI (a Reality server
// answers it with the real site's certificate, so a handshake that completes is "the server is there and is not filtering us";
// the certificate itself is not checked). How far it got tells where it was stopped. Same method as infra/linkprobe/probe.py.
export function probeChannel(
  channel: Pick<Channel, 'host' | 'port' | 'sni'>,
  timeoutMs = PROBE_TIMEOUT_MS,
  connect: typeof tls.connect = tls.connect,
): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    let tcpAt: number | null = null;
    let settled = false;

    const socket = connect({
      host: channel.host,
      port: channel.port,
      servername: channel.sni,
      rejectUnauthorized: false,
      // The wall clock for the whole attempt, not an idle timeout: a server that dribbles bytes must not hold the probe.
    });
    const timer = setTimeout(() => finish(undefined, true), timeoutMs);

    function finish(error: Error | undefined, timedOut = false): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();

      if (!error && !timedOut) {
        resolve({
          result: 'ok',
          tcpMs: tcpAt === null ? null : tcpAt - started,
          tlsMs: tcpAt === null ? null : Date.now() - tcpAt,
          detail: null,
        });

        return;
      }

      const failure = classifyFailure(
        tcpAt === null ? 'tcp' : 'tls',
        error as { code?: string; message?: string } | undefined,
        timedOut,
      );

      resolve({
        ...failure,
        tcpMs: tcpAt === null ? null : tcpAt - started,
        tlsMs: null,
      });
    }

    socket.once('connect', () => {
      tcpAt = Date.now();
    });
    socket.once('secureConnect', () => finish(undefined));
    socket.once('error', (error) => finish(error));
    socket.once('close', () =>
      finish(new Error('closed before the handshake')),
    );
  });
}
