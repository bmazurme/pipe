import {
  VpnConnection,
  VpnConnectionKind,
} from '../entities/vpn-connection.entity';

// Never carries panelApiToken or subscriptionUrl — a listing exists to pick, check, and manage
// connections, not to redisplay a saved secret.
export class VpnConnectionResponseDto {
  id: number;
  name: string;
  serverAddress: string;
  kind: VpnConnectionKind;
  isActive: boolean;
  standby: boolean;
  createdAt: Date;

  static fromEntity(connection: VpnConnection): VpnConnectionResponseDto {
    return {
      id: connection.id,
      name: connection.name,
      serverAddress: connection.serverAddress,
      kind: connection.kind ?? 'panel',
      isActive: connection.isActive,
      standby: connection.standby ?? false,
      createdAt: connection.createdAt,
    };
  }
}
