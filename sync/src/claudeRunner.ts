import { spawn } from 'node:child_process';

// Unattended, non-interactive run: `-p` (print mode) makes Claude Code do one
// turn and exit instead of opening its REPL, and
// `--dangerously-skip-permissions` is required for that turn to actually
// edit files/run tools with nobody at the keyboard to approve them.
//
// That flag is exactly as dangerous as it sounds outside a throwaway
// sandbox: agent-runner MUST run each task in an isolated environment (a
// container/VM with no access to real secrets, per ROADMAP.md section
// 3 point 6) — the git-worktree isolation this module runs inside handles
// disk state, but nothing here sandboxes network or process access. Do not
// point this at a shared server user account.
//
// What the child inherits is limited by buildAgentEnv (an allowlist), but the
// credentials file under sync's state dir is still readable by the same OS
// user, so running the agent as a separate user/container still stands.
export const DEFAULT_AGENT_TIMEOUT_SEC = 30 * 60;
const OUTPUT_TAIL_BYTES = 64 * 1024;

// Any value that is not a positive finite number of seconds falls back to the default.
export function resolveAgentTimeoutMs(raw: string | undefined): number {
  const sec = Number(raw);
  return (Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_AGENT_TIMEOUT_SEC) * 1000;
}

// Variables sync's own secrets live in — never handed to the CLI, which runs an
// unrestricted shell against untrusted parcel/issue content. Wins over everything.
const DENIED_ENV = /^(SYNC_|BRIDGE_|GITLAB_)|_FILE$/;
const ALLOWED_ENV =
  /^(PATH|HOME|LANG|TMPDIR|TERM|USER|SHELL|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|(HTTP|HTTPS|ALL|NO)_PROXY|LC_.*|NODE_.*|XDG_.*)$/i;

// Allowlist of what the claude child may inherit. SYNC_AGENT_ENV_PASS
// (comma-separated names) adds extra variables, but never a denied one.
export function buildAgentEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const extra = new Set(
    (base.SYNC_AGENT_ENV_PASS ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || DENIED_ENV.test(key)) continue;
    if (ALLOWED_ENV.test(key) || extra.has(key)) env[key] = value;
  }
  return env;
}

function defaultTimeoutMs(): number {
  return resolveAgentTimeoutMs(process.env.SYNC_AGENT_TIMEOUT_SEC);
}

// A hung CLI would otherwise block `--watch` forever, so the run has a
// deadline: SIGTERM, then SIGKILL after `killGraceMs`, then a rejection.
// `output` keeps only the last 64 KB of stdout (everything is still streamed).
export function runClaude(
  cwd: string,
  prompt: string,
  model?: string,
  timeoutMs: number = defaultTimeoutMs(),
  killGraceMs = 10_000,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);

    const child = spawn('claude', args, {
      cwd,
      env: buildAgentEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf-8');
      if (output.length > OUTPUT_TAIL_BYTES) output = output.slice(-OUTPUT_TAIL_BYTES);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
    };

    child.on('error', (error) => {
      clearTimers();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('"claude" binary not found on PATH — install Claude Code on this server first.'));
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      clearTimers();
      if (timedOut) {
        reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s and was killed`));
        return;
      }
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

export function buildIssuePrompt(title: string, description: string): string {
  return [
    `Task (GitLab issue): ${title}`,
    '',
    description,
    '',
    'Implement this. The repository in the current working directory is a dedicated ' +
      'git worktree checked out for this task only — make whatever changes are needed ' +
      'directly in it.',
  ].join('\n');
}
