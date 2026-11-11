import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// Two shapes: an x-ui panel (panelUrl + panelApiToken + serverAddress) or a subscription link (subscriptionUrl alone — the
// server comes from the link). The controller rejects a body that mixes them.
const isPanel = (dto: CreateVpnConnectionDto) => !dto.subscriptionUrl;

export class CreateVpnConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  // An https:// address that answers with vless:// links (v2rayN / Hiddify style). It holds the provider's token.
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true })
  subscriptionUrl?: string;

  @ValidateIf(isPanel)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  panelUrl?: string;

  @ValidateIf(isPanel)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  panelApiToken?: string;

  // Hostname, IPv4 or IPv6 literal only: this value is interpolated into the
  // vless:// link and the Xray client config.
  @ValidateIf(isPanel)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|[0-9A-Fa-f:]+)$/, {
    message: 'serverAddress must be a hostname or IP address',
  })
  serverAddress?: string;
}
