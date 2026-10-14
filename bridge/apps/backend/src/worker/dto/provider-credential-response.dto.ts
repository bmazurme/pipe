import {
  ProviderCredential,
  type ProviderModel,
} from '../entities/provider-credential.entity';

// Never carries the key: a listing is for telling entries apart and deleting them (only the last 4 characters
// as a hint). The key leaves bridge once — in the claim response of a job or chat turn it runs.
export class ProviderCredentialResponseDto {
  id: number;
  provider: ProviderModel;
  name: string;
  keyHint: string;
  baseUrl: string | null;
  model: string | null;
  createdAt: Date;

  static fromEntity(
    credential: ProviderCredential,
  ): ProviderCredentialResponseDto {
    return {
      id: credential.id,
      provider: credential.provider,
      name: credential.name,
      keyHint: `…${credential.apiKey.slice(-4)}`,
      baseUrl: credential.baseUrl,
      model: credential.model,
      createdAt: credential.createdAt,
    };
  }
}

// What a worker receives with a claimed gpt/deepseek/qwen job or chat turn.
export class ClaimedProviderDto {
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
}
