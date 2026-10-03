import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';

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

  @Column({ type: 'text' })
  panelUrl: string;

  @Column({ type: 'text' })
  panelApiToken: string;

  @Column({ type: 'varchar', length: 255 })
  serverAddress: string;

  @Column({ type: 'boolean', default: false })
  isActive: boolean;
}
