import { resolveOpenAiCompatibleConfig, type OpenAiCompatibleConfig } from './providers.js';

export type ChatModel = 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';

export type ChatProviderConfig =
  | { tool: 'claude'; claudeModel: 'sonnet' | 'opus' }
  | OpenAiCompatibleConfig;

// Sonnet/Opus chat turns run through the same claude CLI login Worker jobs
// already use (CLAUDE_CODE_OAUTH_TOKEN, or a plain `claude login` session) —
// same resolveProvider('sonnet'|'opus') shape as providers.ts, no API key of
// its own to check here, since the CLI handles its own auth. gpt/deepseek/qwen
// reuse the exact same OpenAI-compatible config jobs already use, unmodified.
export function resolveChatProvider(model: ChatModel, env: NodeJS.ProcessEnv = process.env): ChatProviderConfig {
  if (model === 'sonnet' || model === 'opus') {
    return { tool: 'claude', claudeModel: model };
  }

  return resolveOpenAiCompatibleConfig(model, env);
}
