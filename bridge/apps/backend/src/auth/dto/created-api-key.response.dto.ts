import { CreatedApiKey } from '../api-keys.service';

// Carries the plaintext token — only ever returned once, at creation time.
export class CreatedApiKeyResponseDto {
  id: number;
  name: string;
  prefix: string;
  token: string;
  createdAt: Date;

  static fromCreatedApiKey(apiKey: CreatedApiKey): CreatedApiKeyResponseDto {
    return { ...apiKey };
  }
}
