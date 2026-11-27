import type { ApiKeyScope } from '../api-key-scope';
import { CreatedApiKey } from '../api-keys.service';

// Carries the plaintext token — only ever returned once, at creation time.
export class CreatedApiKeyResponseDto {
  id: number;
  name: string;
  prefix: string;
  scope: ApiKeyScope | null;
  token: string;
  expiresAt: Date | null;
  createdAt: Date;

  static fromCreatedApiKey(apiKey: CreatedApiKey): CreatedApiKeyResponseDto {
    return { ...apiKey };
  }
}
