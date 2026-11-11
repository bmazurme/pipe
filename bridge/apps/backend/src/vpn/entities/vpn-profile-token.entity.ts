import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export const VPN_PROFILE_AUDIENCES = ['phone', 'laptop', 'server'] as const;
export type VpnProfileAudience = (typeof VPN_PROFILE_AUDIENCES)[number];

// A device's right to fetch the VPN profile (the list of links its client picks the best of): one token per device, so a lost phone is
// revoked on its own. Only the SHA-256 of the token is kept; the token itself is shown once, when it is made. Global, like
// VpnConnection: the deployment has one owner and one set of connections.
@Entity({ name: 'vpn_profile_tokens' })
export class VpnProfileToken extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  label: string;

  @Column({ type: 'varchar', length: 20 })
  audience: VpnProfileAudience;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  // The first characters of the token, so the owner can tell the tokens apart in the list.
  @Column({ type: 'varchar', length: 16 })
  tokenPrefix: string;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
