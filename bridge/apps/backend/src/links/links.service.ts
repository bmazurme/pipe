import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { VpnConnectionsService } from '../vpn/vpn-connections.service';
import { VpnLinkResolver } from '../vpn/vpn-link-resolver.service';
import { parseVlessParams } from '../worker/vless-link';
import { LinkProbeResultDto } from './dto/link-probe.dto';
import { LinkProbe } from './entities/link-probe.entity';
import { probeChannel } from './link-probe';
import { assessChannels, Channel, ChannelsView } from './links';
import { LinksAlertsService } from './links-alerts.service';

// The vantage point bridge's own probes are filed under.
export const BRIDGE_VANTAGE = 'bridge';
export const PROBE_EVERY_MS = 60_000;
const PROBE_CONCURRENCY = 4;

@Injectable()
export class LinksService {
  private readonly logger = new Logger(LinksService.name);
  private probing = false;

  constructor(
    @InjectRepository(LinkProbe)
    private readonly probes: Repository<LinkProbe>,
    private readonly connections: VpnConnectionsService,
    private readonly links: VpnLinkResolver,
    private readonly alerts: LinksAlertsService,
  ) {}

  // Every host:port a link of any connection points at, named after its connection (numbered when its pool has several links). A
  // connection that cannot be read now is left out, like in a device profile; the same host:port under two names is one channel.
  async channels(): Promise<Channel[]> {
    const all = await this.connections.findAll();
    const ordered = [
      ...all.filter((c) => c.isActive),
      ...all.filter((c) => !c.isActive),
    ];
    const found = new Map<string, Channel>();

    for (const connection of ordered) {
      let pool: string[];

      try {
        pool = await this.links.resolveMany(connection.id);
      } catch {
        continue;
      }

      pool.forEach((link, index) => {
        try {
          const params = parseVlessParams(link);
          const key = `${params.host}:${params.port}`;

          if (!found.has(key)) {
            found.set(key, {
              key,
              name:
                pool.length > 1
                  ? `${connection.name}-${index + 1}`
                  : connection.name,
              host: params.host,
              port: params.port,
              sni: params.serverName,
            });
          }
        } catch {
          // a link the pool kept but that cannot be read: nothing to probe
        }
      });
    }

    return [...found.values()];
  }

  // A vantage point's latest probes. A result that differs from the stored one restarts "since when".
  async ingest(
    vantage: string,
    results: LinkProbeResultDto[],
    now = new Date(),
  ): Promise<void> {
    if (results.length === 0) return;

    const existing = new Map(
      (await this.probes.find({ where: { vantage } })).map((row) => [
        row.channelKey,
        row,
      ]),
    );
    const rows = results.map((entry) => {
      const before = existing.get(entry.key);
      const row =
        before ?? this.probes.create({ vantage, channelKey: entry.key });

      row.changedAt =
        before && before.result === entry.result ? before.changedAt : now;
      row.result = entry.result;
      row.tcpMs = entry.tcpMs ?? null;
      row.tlsMs = entry.tlsMs ?? null;
      row.detail = entry.detail ?? null;
      row.probedAt = now;

      return row;
    });

    await this.probes.save(rows);
  }

  // Bridge probing every channel itself: the vantage point that needs no agent, so the tile has something from the first minute.
  async probeFromBridge(): Promise<number> {
    const channels = await this.channels();
    const results: LinkProbeResultDto[] = [];
    const queue = [...channels];

    await Promise.all(
      Array.from(
        { length: Math.min(PROBE_CONCURRENCY, queue.length) },
        async () => {
          for (let channel = queue.shift(); channel; channel = queue.shift()) {
            const outcome = await probeChannel(channel);

            results.push({ key: channel.key, ...outcome });
          }
        },
      ),
    );

    await this.ingest(BRIDGE_VANTAGE, results);

    return results.length;
  }

  @Interval(PROBE_EVERY_MS)
  async tick(): Promise<void> {
    if ((process.env.LINK_PROBES ?? '').toLowerCase() === 'off' || this.probing)
      return;

    this.probing = true;

    try {
      await this.probeFromBridge();
      // Judged on every probe round, with whatever the other vantage points have reported by now.
      await this.alerts.evaluate(await this.view());
    } catch (error) {
      this.logger.warn(
        `channel probe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.probing = false;
    }
  }

  async view(now = new Date()): Promise<ChannelsView> {
    const [channels, rows] = await Promise.all([
      this.channels(),
      this.probes.find(),
    ]);

    return assessChannels(channels, rows, now);
  }
}
