import {
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateVpnConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  panelUrl: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  panelApiToken: string;

  // Hostname, IPv4 or IPv6 literal only: this value is interpolated into the
  // vless:// link and the Xray client config.
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|[0-9A-Fa-f:]+)$/, {
    message: 'serverAddress must be a hostname or IP address',
  })
  serverAddress: string;
}
