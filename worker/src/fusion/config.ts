import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// How the worker (and the `fusionctl` tool it hands to the model) finds the pipe add-in running inside Fusion 360. The add-in writes
// this file when it starts: a port on 127.0.0.1 and a random token, readable only by the user Fusion runs as. It is the same trust
// as the worker itself, which runs the model with `--dangerously-skip-permissions` as that user on that machine.
export interface FusionAddinConfig {
  url: string;
  token: string;
}

export class FusionNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FusionNotConfiguredError';
  }
}

export function fusionConfigPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env.PIPE_FUSION_CONFIG?.trim() || path.join(home, '.pipe-fusion', 'config.json');
}

export function readFusionConfig(
  env: NodeJS.ProcessEnv = process.env,
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
  home?: string,
): FusionAddinConfig {
  const file = fusionConfigPath(env, home);
  let raw: string;

  try {
    raw = read(file);
  } catch {
    throw new FusionNotConfiguredError(
      `The pipe add-in for Fusion 360 has not written ${file}: Fusion is not running, or the add-in is not installed/started (see worker/fusion-addin/README.md)`,
    );
  }

  let parsed: { port?: unknown; token?: unknown };

  try {
    parsed = JSON.parse(raw) as { port?: unknown; token?: unknown };
  } catch {
    throw new FusionNotConfiguredError(`${file} is not valid JSON — restart the add-in in Fusion 360`);
  }

  const port = typeof parsed.port === 'number' ? parsed.port : Number(parsed.port);

  if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof parsed.token !== 'string' || parsed.token.length < 16) {
    throw new FusionNotConfiguredError(`${file} has no valid port and token — restart the add-in in Fusion 360`);
  }

  return { url: `http://127.0.0.1:${port}`, token: parsed.token };
}
