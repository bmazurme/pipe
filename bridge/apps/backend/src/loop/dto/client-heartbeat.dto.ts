import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const CLIENT_KINDS = ['reports'] as const;

export class ClientHeartbeatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsIn(CLIENT_KINDS)
  kind: (typeof CLIENT_KINDS)[number];
}
