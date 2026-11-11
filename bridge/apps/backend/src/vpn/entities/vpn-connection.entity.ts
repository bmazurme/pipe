import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';

export type VpnConnectionKind = 'panel' | 'subscription';

// A named VPN node (x-ui panel + the server it manages) — bridge can hold
// several, but only ever routes worker's actual traffic through whichever
// one has isActive: true (see VpnConnectionsService.activate, which keeps
// that a hard single-row invariant). Global, not per-user: there is exactly
// one shared worker/vpn-client tunnel for the whole account, not one per
// bridge user.
@Entity({ name: 'vpn_connections' })
export class VpnConnection extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  // 'panel': an x-ui panel bridge reads the client from (panelUrl, panelApiToken, serverAddress). 'subscription': an https
  // subscription link that answers with vless:// links (subscriptionUrl); panelUrl and panelApiToken are then empty and
  // serverAddress is the host of the link in use.
  @Column({ type: 'varchar', length: 20, default: 'panel' })
  kind: VpnConnectionKind;

  // Carries the provider's token in its path — encrypted like panelApiToken, never read back by any route.
  @Column({ type: 'text', nullable: true, transformer: encryptedColumn })
  subscriptionUrl: string | null;

  @Column({ type: 'text' })
  panelUrl: string;

  // Encrypted at rest (AES-256-GCM via encryptedColumn) — a DB dump or
  // pgadmin access no longer hands over usable VPN panel credentials.
  @Column({ type: 'text', transformer: encryptedColumn })
  panelApiToken: string;

  @Column({ type: 'varchar', length: 255 })
  serverAddress: string;

  @Column({ type: 'boolean', default: false })
  isActive: boolean;

  // Set when a Telegram alert was sent for this connection being unreachable,
  // cleared on the next successful status check — so a down panel pages the
  // owner once, not on every poll, and the next outage pages again rather
  // than staying silent forever.
  @Column({ type: 'timestamp', nullable: true })
  failureAlertedAt: Date | null;
}
