import { ApiKey } from '../entities/api-key.entity';

// Never includes the secret itself — only what a listing needs to tell keys
// apart and decide whether to revoke one.
export class ApiKeyResponseDto {
  id: number;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;

  static fromEntity(apiKey: ApiKey): ApiKeyResponseDto {
    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
    };
  }
}
