import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  PROVIDER_MODELS,
  type ProviderModel,
} from '../entities/provider-credential.entity';

export class CreateProviderCredentialDto {
  @IsIn(PROVIDER_MODELS)
  provider: ProviderModel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  apiKey: string;

  // Only for a provider reached through another endpoint (a proxy, a self-hosted gateway).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/\S+$/, { message: 'baseUrl must be an http(s) URL' })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
