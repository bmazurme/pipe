import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  PROVIDER_AUTH_SCHEMES,
  PROVIDER_MODELS,
  PROVIDER_ROUTES,
  type ProviderAuthScheme,
  type ProviderModel,
  type ProviderRoute,
} from '../entities/provider-credential.entity';

export const MAX_TIMEOUT_SEC = 1800;
export const MAX_EXTRA_HEADERS = 10;

export class CreateProviderCredentialDto {
  @IsIn(PROVIDER_MODELS)
  provider: ProviderModel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  // Required, except for a custom key with authScheme 'none' (a local server): the service says which.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  apiKey?: string;

  // Only for a provider reached through another endpoint (a proxy, a self-hosted gateway); required for custom.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/\S+$/, { message: 'baseUrl must be an http(s) URL' })
  baseUrl?: string;

  // Required for custom.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  // The fields below are for custom keys; they are ignored for gpt/deepseek/qwen.
  @IsOptional()
  @IsIn(PROVIDER_ROUTES)
  route?: ProviderRoute;

  @IsOptional()
  @IsIn(PROVIDER_AUTH_SCHEMES)
  authScheme?: ProviderAuthScheme;

  // Header name → value (e.g. x-folder-id for Yandex).
  @IsOptional()
  @IsObject()
  extraHeaders?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(MAX_TIMEOUT_SEC)
  timeoutSec?: number;

  @IsOptional()
  @IsBoolean()
  supportsTools?: boolean;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  priceInPerMTok?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  priceOutPerMTok?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  preset?: string;

  // Only these workers may use the key; absent or empty = any.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  allowedWorkerIds?: number[];
}
