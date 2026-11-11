import { BadGatewayException, Injectable } from '@nestjs/common';
import { createConnection } from 'node:net';

import { parseVlessLink } from '../worker/vless-link';
import { OUTBOUND_FETCH_TIMEOUT_MS, isTimeoutError } from './outbound';
import {
  assertPublicHttpsUrl,
  parseSubscriptionBody,
  ParsedSubscription,
} from './subscription';

// A subscription answers with a few hundred bytes to a few hundred KB; anything bigger is not one.
export const MAX_SUBSCRIPTION_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
export const PROBE_TIMEOUT_MS = 5_000;
// How many links of one subscription go into a tunnel's pool: more adds probing cost and nothing to resilience.
export const MAX_POOL_LINKS = 6;

export interface ResolvedSubscription extends ParsedSubscription {
  /** The first usable link — the one the tunnel runs with. */
  link: string;
  host: string;
  port: number;
}

@Injectable()
export class SubscriptionService {
  // Never put the address in a message: it carries the owner's token.
  private async download(rawUrl: string, label: string): Promise<string> {
    let url: URL;

    try {
      url = assertPublicHttpsUrl(rawUrl);
    } catch (error) {
      throw new BadGatewayException(
        `VPN «${label}»: ${error instanceof Error ? error.message : 'неверная ссылка подписки'}`,
      );
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response: Response;

      try {
        response = await fetch(url, {
          redirect: 'manual',
          headers: {
            'User-Agent': 'pipe-bridge',
            Accept: 'text/plain, */*',
          },
          signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new BadGatewayException(
            `VPN «${label}»: подписка не ответила за ${OUTBOUND_FETCH_TIMEOUT_MS} мс`,
          );
        }

        const cause = (error as { cause?: { code?: string } })?.cause;

        throw new BadGatewayException(
          `VPN «${label}»: подписка недоступна из bridge (${cause?.code ?? 'ошибка сети'})`,
        );
      }

      const location = response.headers.get('location');

      if (response.status >= 300 && response.status < 400 && location) {
        try {
          url = assertPublicHttpsUrl(new URL(location, url).toString());
        } catch (error) {
          throw new BadGatewayException(
            `VPN «${label}»: подписка перенаправляет не туда (${error instanceof Error ? error.message : 'ошибка'})`,
          );
        }
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new BadGatewayException(
          `VPN «${label}»: подписка отклонила запрос (${response.status}) — проверьте ссылку`,
        );
      }

      if (!response.ok) {
        throw new BadGatewayException(
          `VPN «${label}»: подписка ответила ${response.status}`,
        );
      }

      const declared = Number(response.headers.get('content-length') ?? 0);
      const bytes =
        declared > MAX_SUBSCRIPTION_BYTES ? null : await response.arrayBuffer();

      if (bytes === null || bytes.byteLength > MAX_SUBSCRIPTION_BYTES) {
        throw new BadGatewayException(
          `VPN «${label}»: ответ подписки слишком большой`,
        );
      }

      return Buffer.from(bytes).toString('utf8');
    }

    throw new BadGatewayException(
      `VPN «${label}»: слишком много перенаправлений у подписки`,
    );
  }

  // The links a subscription holds and the one a tunnel would use. `label` is only for messages.
  async resolve(
    rawUrl: string,
    label = 'подписка',
  ): Promise<ResolvedSubscription> {
    const parsed = parseSubscriptionBody(await this.download(rawUrl, label));
    const link = parsed.links[0];

    if (!link) {
      throw new BadGatewayException(
        `VPN «${label}»: в подписке нет ссылки, с которой можно поднять туннель (нужна vless:// с security=reality и tcp)${parsed.unsupported ? `; других ссылок: ${parsed.unsupported}` : ''}`,
      );
    }

    const { host, port } = parseVlessLink(link);

    return { ...parsed, link, host: host.replace(/^\[|\]$/g, ''), port };
  }

  // Whether the VPN server itself answers from here — the nearest thing to "online" a bare subscription can tell (there is no
  // panel to ask for the last connection).
  probe(
    host: string,
    port: number,
    timeoutMs = PROBE_TIMEOUT_MS,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      const done = (error?: Error) => {
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };

      socket.setTimeout(timeoutMs, () =>
        done(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
      );
      socket.once('connect', () => done());
      socket.once('error', (error) => done(error));
    });
  }
}
