import {
  ProviderCredential,
  type ProviderAuthScheme,
  type ProviderModel,
  type ProviderRoute,
} from '../entities/provider-credential.entity';

// Never carries the key: a listing is for telling entries apart and deleting them (only the last 4 characters
// as a hint). The key leaves bridge once — in the claim response of a job or chat turn it runs. The extra headers
// are shown by name only, for the same reason.
export class ProviderCredentialResponseDto {
  id: number;
  provider: ProviderModel;
  name: string;
  keyHint: string;
  baseUrl: string | null;
  model: string | null;
  route: ProviderRoute;
  authScheme: ProviderAuthScheme;
  extraHeaderNames: string[];
  timeoutSec: number | null;
  supportsTools: boolean;
  stream: boolean;
  priceInPerMTok: number | null;
  priceOutPerMTok: number | null;
  preset: string | null;
  allowedWorkerIds: number[] | null;
  createdAt: Date;

  static fromEntity(
    credential: ProviderCredential,
  ): ProviderCredentialResponseDto {
    return {
      id: credential.id,
      provider: credential.provider,
      name: credential.name,
      keyHint: credential.apiKey ? `…${credential.apiKey.slice(-4)}` : '',
      baseUrl: credential.baseUrl,
      model: credential.model,
      route: credential.route ?? 'auto',
      authScheme: credential.authScheme ?? 'bearer',
      extraHeaderNames: Object.keys(credential.extraHeaders ?? {}),
      timeoutSec: credential.timeoutSec ?? null,
      supportsTools: credential.supportsTools ?? true,
      stream: credential.stream ?? false,
      priceInPerMTok: toNumber(credential.priceInPerMTok),
      priceOutPerMTok: toNumber(credential.priceOutPerMTok),
      preset: credential.preset ?? null,
      allowedWorkerIds: credential.allowedWorkerIds ?? null,
      createdAt: credential.createdAt,
    };
  }
}

function toNumber(value: string | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

// What a worker receives with a claimed gpt/deepseek/qwen/custom job or chat turn. The last five are set only for a custom
// key, so a claim for the three named providers looks exactly as it always did.
export class ClaimedProviderDto {
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
  route?: ProviderRoute;
  authScheme?: ProviderAuthScheme;
  extraHeaders?: Record<string, string>;
  timeoutSec?: number | null;
  supportsTools?: boolean;
}
