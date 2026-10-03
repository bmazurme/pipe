import { Equals, IsEnum, IsNotEmpty, IsString } from 'class-validator';

// Deliberately not an arbitrary secret name — the request body choosing
// which GitHub secret to overwrite would otherwise let this endpoint
// clobber anything in the repo (JWT_SECRET, POSTGRES_PASSWORD, ...). Mirrors
// exactly the WORKER_* secrets bridge-stack.yml's worker service reads.
export enum WorkerSecretName {
  OpenAiApiKey = 'WORKER_OPENAI_API_KEY',
  DeepseekApiKey = 'WORKER_DEEPSEEK_API_KEY',
  QwenApiKey = 'WORKER_QWEN_API_KEY',
  ClaudeCodeOAuthToken = 'WORKER_CLAUDE_CODE_OAUTH_TOKEN',
}

export class SetWorkerSecretDto {
  @IsEnum(WorkerSecretName)
  name: WorkerSecretName;

  @IsString()
  @IsNotEmpty()
  value: string;

  // See ConfirmActionDto's own comment — same "are you sure" gate.
  @Equals(true)
  confirm: boolean;
}
