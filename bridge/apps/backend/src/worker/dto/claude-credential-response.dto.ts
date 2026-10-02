import { ClaudeCredential } from '../entities/claude-credential.entity';

// Never carries the token value — write-once, same as the GitHub-secrets
// worker keys: a listing exists to tell entries apart and delete them, not
// to redisplay a saved secret.
export class ClaudeCredentialResponseDto {
  id: number;
  name: string;
  createdAt: Date;

  static fromEntity(credential: ClaudeCredential): ClaudeCredentialResponseDto {
    return {
      id: credential.id,
      name: credential.name,
      createdAt: credential.createdAt,
    };
  }
}
