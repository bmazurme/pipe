import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';

import {
  CreatedVpnProfileDto,
  VpnProfileResponseDto,
} from './dto/vpn-profile.dto';
import {
  VpnProfileAudience,
  VpnProfileToken,
} from './entities/vpn-profile-token.entity';
import { renameLink } from './subscription';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnLinkResolver } from './vpn-link-resolver.service';

export const TOKEN_PREFIX = 'brp_';
export const PROFILE_PATH = '/api/v1/vpn/profile';
// A device's client picks the best of the list on its own; more than this only slows its probing down.
export const MAX_PROFILE_LINKS = 20;
// "Last used" is for the owner to see a dead device, not an audit log: one write per few minutes is enough.
const LAST_USED_EVERY_MS = 5 * 60_000;

const hashOf = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export interface BuiltProfile {
  /** One vless:// link per line's worth, each named after its connection. */
  links: string[];
  /** Connections that could not be read just now (a panel or a provider is down); the rest are still served. */
  failed: string[];
}

@Injectable()
export class VpnProfilesService {
  private readonly logger = new Logger(VpnProfilesService.name);

  constructor(
    @InjectRepository(VpnProfileToken)
    private readonly tokens: Repository<VpnProfileToken>,
    private readonly connections: VpnConnectionsService,
    private readonly links: VpnLinkResolver,
  ) {}

  async create(
    label: string,
    audience: VpnProfileAudience,
  ): Promise<CreatedVpnProfileDto> {
    const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
    const saved = await this.tokens.save(
      this.tokens.create({
        label: label.trim(),
        audience,
        tokenHash: hashOf(token),
        tokenPrefix: token.slice(0, 8),
        lastUsedAt: null,
        revokedAt: null,
      }),
    );

    this.logger.warn(
      `VPN profile token ${saved.id} («${saved.label}», ${audience}) created`,
    );

    return {
      ...VpnProfileResponseDto.fromEntity(saved),
      token,
      path: `${PROFILE_PATH}/${token}`,
    };
  }

  async list(): Promise<VpnProfileResponseDto[]> {
    const rows = await this.tokens.find({ order: { id: 'ASC' } });

    return rows.map(VpnProfileResponseDto.fromEntity);
  }

  async revoke(id: number): Promise<void> {
    const row = await this.tokens.findOneBy({ id });

    if (!row) throw new NotFoundException('VPN profile token not found');
    if (row.revokedAt) return;

    row.revokedAt = new Date();
    await this.tokens.save(row);
    this.logger.warn(`VPN profile token ${id} («${row.label}») revoked`);
  }

  // The token a device presented, or null for an unknown or revoked one (the caller answers both the same way).
  async authenticate(
    token: string,
    now = new Date(),
  ): Promise<VpnProfileToken | null> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;

    const row = await this.tokens.findOneBy({
      tokenHash: hashOf(token),
      revokedAt: IsNull(),
    });

    if (!row) return null;

    if (
      !row.lastUsedAt ||
      now.getTime() - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS
    ) {
      await this.tokens.update({ id: row.id }, { lastUsedAt: now });
    }

    return row;
  }

  // Every usable link of every connection, the active connection first, each named after its connection (a connection with
  // several links gets -1, -2, …). A connection that cannot be read now is skipped, not fatal: the device still gets the rest.
  async build(): Promise<BuiltProfile> {
    const all = await this.connections.findAll();
    const ordered = [
      ...all.filter((c) => c.isActive),
      ...all.filter((c) => !c.isActive),
    ];
    const links: string[] = [];
    const failed: string[] = [];

    for (const connection of ordered) {
      try {
        const pool = await this.links.resolveMany(connection.id);

        pool.forEach((link, index) => {
          const name =
            pool.length > 1
              ? `${connection.name}-${index + 1}`
              : connection.name;
          const named = renameLink(link, name);

          if (!links.includes(named)) links.push(named);
        });
      } catch {
        failed.push(connection.name);
      }
    }

    return { links: links.slice(0, MAX_PROFILE_LINKS), failed };
  }
}

// The format v2rayN, Hiddify, v2rayNG and most clients import: the links one per line, base64-encoded.
export function toSubscription(links: string[]): string {
  return Buffer.from(links.join('\n'), 'utf8').toString('base64');
}
