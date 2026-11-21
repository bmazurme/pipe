import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';

import { CreateVpnConnectionDto } from './create-vpn-connection.dto';

export class UpdateVpnConnectionDto extends PartialType(
  CreateVpnConnectionDto,
) {
  // Joins the active connection's links in the tunnel (see VpnConnection.inPool).
  @IsOptional()
  @IsBoolean()
  inPool?: boolean;
}
