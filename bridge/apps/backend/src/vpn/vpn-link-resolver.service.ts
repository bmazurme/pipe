import { Injectable } from '@nestjs/common';

import { VpnConnectionsService } from './vpn-connections.service';
import { VpnService } from './vpn.service';

// Workers fetch their settings before every poll (every few seconds), so the link built from a panel is reused for a
// minute rather than asking the panel each time.
export const LINK_TTL_MS = 60_000;

interface CachedLink {
  link: string;
  at: number;
}

// Builds the vless:// link a worker's tunnel runs with from a connection of the VPN page. The panel is a separate
// server that may be down for a while: a failed refresh keeps handing out the last link that worked (the tunnel
// itself is usually fine), and only a link nobody ever built is an error.
@Injectable()
export class VpnLinkResolver {
  private readonly cache = new Map<number, CachedLink>();
  private readonly inFlight = new Map<number, Promise<string>>();

  constructor(
    private readonly connections: VpnConnectionsService,
    private readonly vpn: VpnService,
  ) {}

  // 'active' follows the VPN page's active connection; a number is that connection.
  async resolve(target: number | 'active'): Promise<string> {
    const id =
      target === 'active' ? (await this.connections.getActive()).id : target;
    const cached = this.cache.get(id);

    if (cached && Date.now() - cached.at < LINK_TTL_MS) return cached.link;

    try {
      const link = await this.refresh(id);

      this.cache.set(id, { link, at: Date.now() });

      return link;
    } catch (error) {
      if (cached) return cached.link;

      throw error;
    }
  }

  private refresh(id: number): Promise<string> {
    const running = this.inFlight.get(id);

    if (running) return running;

    const request = this.vpn
      .getConnectionLink(id)
      .then(({ link }) => link)
      .finally(() => this.inFlight.delete(id));

    this.inFlight.set(id, request);

    return request;
  }
}
