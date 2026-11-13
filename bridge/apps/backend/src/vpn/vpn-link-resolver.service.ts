import { Injectable } from '@nestjs/common';

import { MAX_POOL_LINKS, SubscriptionService } from './subscription.service';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnService } from './vpn.service';

// Workers fetch their settings before every poll (every few seconds), so the link built from a panel is reused for a
// minute rather than asking the panel each time.
export const LINK_TTL_MS = 60_000;

interface CachedLinks {
  links: string[];
  at: number;
}

// Builds the vless:// link a worker's tunnel runs with from a connection of the VPN page. The panel is a separate
// server that may be down for a while: a failed refresh keeps handing out the last link that worked (the tunnel
// itself is usually fine), and only a link nobody ever built is an error.
@Injectable()
export class VpnLinkResolver {
  private readonly cache = new Map<number, CachedLinks>();
  private readonly subscriptionCache = new Map<string, CachedLinks>();
  private readonly failedAt = new Map<number, { at: number; error: unknown }>();
  private readonly inFlight = new Map<number, Promise<string[]>>();

  constructor(
    private readonly connections: VpnConnectionsService,
    private readonly vpn: VpnService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  // The first link of the pool — what a single-link consumer takes.
  async resolve(target: number | 'active'): Promise<string> {
    return (await this.resolveMany(target))[0];
  }

  // 'active' follows the VPN page's active connection; a number is that connection. All the links a tunnel can balance over.
  async resolveMany(target: number | 'active'): Promise<string[]> {
    const id =
      target === 'active' ? (await this.connections.getActive()).id : target;
    const cached = this.cache.get(id);

    if (cached && Date.now() - cached.at < LINK_TTL_MS) return cached.links;

    if (cached) {
      // Stale-while-revalidate: a down panel must not stall a settings fetch, so hand out the old link at once and
      // refresh behind it, but not again until a TTL has passed since the last failure.
      const failed = this.failedAt.get(id);

      if (!failed || Date.now() - failed.at >= LINK_TTL_MS) {
        this.refreshInBackground(id).catch(() => undefined);
      }

      return cached.links;
    }

    // Never resolved: a panel that is down must not be asked on every call (each wait is a 10 s timeout), so within
    // a TTL of the last failure rethrow that failure instead.
    const failed = this.failedAt.get(id);

    if (failed && Date.now() - failed.at < LINK_TTL_MS) throw failed.error;

    return this.refreshInBackground(id);
  }

  // A worker whose own VPN field holds a subscription link (https://…): the first usable vless:// link on it, cached for a minute
  // like a panel's, and kept at its last good value while the provider is down.
  async resolveSubscription(url: string): Promise<string> {
    return (await this.resolveSubscriptionMany(url))[0];
  }

  async resolveSubscriptionMany(url: string): Promise<string[]> {
    const cached = this.subscriptionCache.get(url);

    if (cached && Date.now() - cached.at < LINK_TTL_MS) return cached.links;

    try {
      const { links } = await this.subscriptions.resolve(url, 'подписка');
      const pool = links.slice(0, MAX_POOL_LINKS);

      this.subscriptionCache.set(url, { links: pool, at: Date.now() });

      return pool;
    } catch (error) {
      if (cached) {
        // Stale on purpose; try again after a TTL rather than on every settings fetch.
        this.subscriptionCache.set(url, {
          links: cached.links,
          at: Date.now(),
        });

        return cached.links;
      }

      throw error;
    }
  }

  // Whether a link can be used at all, asked fresh — what saving a worker's VPN field checks.
  async checkSubscription(url: string): Promise<void> {
    await this.subscriptions.resolve(url, 'подписка');
  }

  private async refreshInBackground(id: number): Promise<string[]> {
    try {
      const links = await this.refresh(id);

      this.cache.set(id, { links, at: Date.now() });
      this.failedAt.delete(id);

      return links;
    } catch (error) {
      this.failedAt.set(id, { at: Date.now(), error });

      throw error;
    }
  }

  private refresh(id: number): Promise<string[]> {
    const running = this.inFlight.get(id);

    if (running) return running;

    const request = this.vpn
      .getConnectionLinks(id)
      .finally(() => this.inFlight.delete(id));

    this.inFlight.set(id, request);

    return request;
  }
}
