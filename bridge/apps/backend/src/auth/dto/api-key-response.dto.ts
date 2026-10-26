import { ApiKey } from '../entities/api-key.entity';

// Never includes the secret itself — only what a listing needs to tell keys
// apart and decide whether to revoke one.
export class ApiKeyResponseDto {
  id: number;
  name: string;
  prefix: string;
  scope: 'boards' | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;

  static fromEntity(apiKey: ApiKey): ApiKeyResponseDto {
    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      scope: apiKey.scope ?? null,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      expiresAt: apiKey.expiresAt ?? null,
    };
  }
}
