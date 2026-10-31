import { resolveOpenAiCompatibleConfig, type ClaudeModel, type OpenAiCompatibleConfig, type ProviderOverride } from './providers.js';

export type ChatModel = ClaudeModel | 'gpt' | 'deepseek' | 'qwen' | 'custom';

export type ChatProviderConfig =
  | { tool: 'claude'; claudeModel: ClaudeModel }
  | OpenAiCompatibleConfig;

// Sonnet/Opus/Haiku chat turns run through the same claude CLI login Worker jobs
// already use (CLAUDE_CODE_OAUTH_TOKEN, or a plain `claude login` session) —
// same resolveProvider('sonnet'|'opus'|'haiku') shape as providers.ts, no API key of
// its own to check here, since the CLI handles its own auth. gpt/deepseek/qwen
// reuse the exact same OpenAI-compatible config jobs already use, unmodified.
export function resolveChatProvider(
  model: ChatModel,
  env: NodeJS.ProcessEnv = process.env,
  override?: ProviderOverride | null,
): ChatProviderConfig {
  if (model === 'sonnet' || model === 'opus' || model === 'haiku') {
    return { tool: 'claude', claudeModel: model };
  }

  return resolveOpenAiCompatibleConfig(model, env, override);
}
