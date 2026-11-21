import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';

import { CreateVpnConnectionDto } from './create-vpn-connection.dto';

export class UpdateVpnConnectionDto extends PartialType(
  CreateVpnConnectionDto,
) {
  // A cold standby behind the active connection (see VpnConnection.standby).
  @IsOptional()
  @IsBoolean()
  standby?: boolean;
}
