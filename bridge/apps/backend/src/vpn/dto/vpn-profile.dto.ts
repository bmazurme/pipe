import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import {
  VPN_PROFILE_AUDIENCES,
  VpnProfileAudience,
  VpnProfileToken,
} from '../entities/vpn-profile-token.entity';

export class CreateVpnProfileDto {
  // What the device is called in the list: «iPhone», «MacBook», …
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @IsIn(VPN_PROFILE_AUDIENCES)
  audience: VpnProfileAudience;
}

// Renaming a device changes only how it is listed: its token, its link and what the client fetches stay as they are.
export class UpdateVpnProfileDto {
  // Trimmed before it is checked, so a name of spaces is empty (and refused) rather than a blank row in the list.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;
}

// What the owner sees of a token. The token itself only ever appears in CreatedVpnProfileDto, once.
export class VpnProfileResponseDto {
  id: number;
  label: string;
  audience: VpnProfileAudience;
  tokenPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;

  static fromEntity(entity: VpnProfileToken): VpnProfileResponseDto {
    return {
      id: entity.id,
      label: entity.label,
      audience: entity.audience,
      tokenPrefix: entity.tokenPrefix,
      createdAt: entity.createdAt,
      lastUsedAt: entity.lastUsedAt ?? null,
      revokedAt: entity.revokedAt ?? null,
    };
  }
}

export class CreatedVpnProfileDto extends VpnProfileResponseDto {
  // Shown once. The device is given `path` appended to bridge's API address.
  token: string;
  path: string;
}
