import { ApiProperty } from '@nestjs/swagger';

import type { ClaudeLimits } from '../claude-limits';
import { ClaudeCredential } from '../entities/claude-credential.entity';

// Never carries the token value — write-once, same as the GitHub-secrets
// worker keys: a listing exists to tell entries apart and delete them, not
// to redisplay a saved secret.
export class ClaudeCredentialResponseDto {
  id: number;
  name: string;
  createdAt: Date;
  // The plan limits the last run on this token reported, or null before any run did.
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  limits: ClaudeLimits | null;

  static fromEntity(credential: ClaudeCredential): ClaudeCredentialResponseDto {
    return {
      id: credential.id,
      name: credential.name,
      createdAt: credential.createdAt,
      limits: credential.limits ?? null,
    };
  }
}
