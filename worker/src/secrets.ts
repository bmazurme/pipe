import { readFileSync } from 'node:fs';

// Docker/Swarm secrets land as files under /run/secrets/*, never as plain
// env — but every other module in this codebase (config.ts, providers.ts,
// chatProviders.ts, claudeRunner.ts's own env passthrough) reads a secret
// straight off `process.env`. Rather than touching every one of those call
// sites, this resolves the `<KEY>_FILE` convention once at startup,
// synthesizing the plain `process.env[key]` everything else already
// expects. A key explicitly set in the plain env wins (lets local dev keep
// using a plain .env with no file indirection at all).
export function resolveFileSecrets(env: NodeJS.ProcessEnv, keys: string[]): void {
  for (const key of keys) {
    if (env[key]) continue;

    const filePath = env[`${key}_FILE`];
    if (!filePath) continue;

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot read ${key}_FILE (${filePath}): ${message}`);
    }

    const value = content.trim();
    if (!value) throw new Error(`${key}_FILE (${filePath}) is empty`);

    env[key] = value;
  }
}

export const SECRET_ENV_KEYS = [
  'BRIDGE_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'QWEN_API_KEY',
];
