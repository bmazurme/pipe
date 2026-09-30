export type JobModel = 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';

export type ProviderConfig =
  | { tool: 'claude'; claudeModel: 'sonnet' | 'opus' }
  | { tool: 'openai-compatible'; baseUrl: string; apiKey: string; model: string };

interface OpenAiCompatibleDefaults {
  baseUrlEnv: string;
  defaultBaseUrl: string;
  apiKeyEnv: string;
  modelEnv: string;
  defaultModel: string;
}

// gpt/deepseek/qwen all expose the same OpenAI-compatible Chat Completions +
// function-calling API — one HTTP client (openAiCompatibleRunner.ts), three
// provider configs. Every value is overridable via env so a provider
// renaming/deprecating a model doesn't require a code change.
const OPENAI_COMPATIBLE_DEFAULTS: Record<'gpt' | 'deepseek' | 'qwen', OpenAiCompatibleDefaults> = {
  gpt: {
    baseUrlEnv: 'OPENAI_BASE_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o',
  },
  deepseek: {
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultModel: 'deepseek-chat',
  },
  qwen: {
    // DashScope's OpenAI-compatible endpoint.
    baseUrlEnv: 'QWEN_BASE_URL',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'QWEN_API_KEY',
    modelEnv: 'QWEN_MODEL',
    defaultModel: 'qwen-plus',
  },
};

// Resolved lazily (per job), not eagerly at startup, so worker can still run
// with only some providers configured — a job for an unconfigured provider
// fails with a clear message instead of the whole process refusing to start.
export function resolveProvider(model: JobModel, env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  if (model === 'sonnet' || model === 'opus') {
    return { tool: 'claude', claudeModel: model };
  }

  const defaults = OPENAI_COMPATIBLE_DEFAULTS[model];
  const apiKey = env[defaults.apiKeyEnv];

  if (!apiKey) {
    throw new Error(`${defaults.apiKeyEnv} is not set — required to run the "${model}" model`);
  }

  return {
    tool: 'openai-compatible',
    baseUrl: env[defaults.baseUrlEnv] ?? defaults.defaultBaseUrl,
    apiKey,
    model: env[defaults.modelEnv] ?? defaults.defaultModel,
  };
}
