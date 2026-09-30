import { resolveOpenAiCompatibleConfig, type OpenAiCompatibleConfig } from './providers.js';

export type ChatModel = 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';

export type ChatProviderConfig =
  | { tool: 'anthropic'; apiKey: string; baseUrl: string; model: string }
  | OpenAiCompatibleConfig;

const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_MODEL_ENV: Record<'sonnet' | 'opus', string> = {
  sonnet: 'ANTHROPIC_SONNET_MODEL',
  opus: 'ANTHROPIC_OPUS_MODEL',
};
// Anthropic's API expects a real model id, not the claude CLI's short
// aliases — these defaults are overridable via env for exactly that reason
// (and so a future model rename doesn't need a code change), same rule
// already applied to OPENAI_MODEL/DEEPSEEK_MODEL/QWEN_MODEL.
const ANTHROPIC_DEFAULT_MODEL: Record<'sonnet' | 'opus', string> = {
  sonnet: 'claude-sonnet-4-5',
  opus: 'claude-opus-4-1',
};

// Chat has no working directory, no file tools, no claude CLI — a plain
// chat turn is one request/response call against each provider's own text
// completion API. sonnet/opus go straight to Anthropic's Messages API
// (ANTHROPIC_API_KEY, distinct from the claude CLI's own separate login —
// Worker jobs still use that CLI unchanged); gpt/deepseek/qwen reuse the
// exact same OpenAI-compatible config jobs already use, unmodified.
export function resolveChatProvider(model: ChatModel, env: NodeJS.ProcessEnv = process.env): ChatProviderConfig {
  if (model === 'sonnet' || model === 'opus') {
    const apiKey = env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error(`ANTHROPIC_API_KEY is not set — required to use the "${model}" model in chat`);
    }

    return {
      tool: 'anthropic',
      apiKey,
      baseUrl: env.ANTHROPIC_BASE_URL ?? ANTHROPIC_DEFAULT_BASE_URL,
      model: env[ANTHROPIC_MODEL_ENV[model]] ?? ANTHROPIC_DEFAULT_MODEL[model],
    };
  }

  return resolveOpenAiCompatibleConfig(model, env);
}
