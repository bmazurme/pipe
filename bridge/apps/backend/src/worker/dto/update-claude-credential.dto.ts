import { PickType } from '@nestjs/swagger';

import { CreateClaudeCredentialDto } from './create-claude-credential.dto';

export class UpdateClaudeCredentialDto extends PickType(
  CreateClaudeCredentialDto,
  ['token'] as const,
) {}
