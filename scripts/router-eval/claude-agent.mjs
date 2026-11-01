// A Claude model working on a replayed task the way a worker's job does — reading, editing, running the tests — but with the shell
// narrowed to what checking a change needs, because here it runs on the owner's own machine and not on a disposable worker.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Files: read and edit freely. Shell: run tests, type checks and scripts, and look at git — no installs, no network tools, no `rm`.
export const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(npx jest:*)',
  'Bash(npx vitest:*)',
  'Bash(npx tsc:*)',
  'Bash(npx eslint:*)',
  'Bash(npx prettier:*)',
  'Bash(npm test:*)',
  'Bash(npm run:*)',
  'Bash(node:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(grep:*)',
];

export function agentArgs({ prompt, model }) {
  return ['-p', prompt, '--model', model, '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED_TOOLS];
}

// The CLI's one JSON object: the answer, the cost and what the run used. null when the output is not that.
export function parseAgentResult(stdout) {
  try {
    const parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) ?? '');

    // a result of the CLI, not any JSON: it has `result` or says `is_error`
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('result' in parsed || 'is_error' in parsed)) return null;

    const usage = parsed.usage ?? {};
    const total = (...keys) => keys.reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);

    return {
      text: typeof parsed.result === 'string' ? parsed.result : '',
      isError: parsed.is_error === true,
      costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
      turns: Number(parsed.num_turns) || 0,
      inputTokens: total('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'),
      outputTokens: total('output_tokens'),
    };
  } catch {
    return null;
  }
}

// { exitCode, output, report } like the worker's runners: the project is the directory, the task is the prompt.
export function runClaudeAgent(dir, prompt, { model, timeoutMs = 900_000 }) {
  // run from the checkout, so the project's own CLAUDE.md is what the model reads, as in a Lab run
  return new Promise((resolve, reject) => {
    const scratch = mkdtempSync(join(tmpdir(), 'router-claude-'));
    const child = spawn('claude', agentArgs({ prompt, model }), { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      rmSync(scratch, { recursive: true, force: true });

      const result = parseAgentResult(stdout);

      if (signal === 'SIGKILL') return reject(new Error(`the model did not finish in ${Math.round(timeoutMs / 1000)} s`));
      if (!result) return reject(new Error(`unreadable output from claude (exit ${code}): ${(stderr || stdout).trim().slice(0, 300)}`));

      resolve({
        exitCode: code === 0 && !result.isError ? 0 : 1,
        output: `${result.text}\n[turns ${result.turns}, tokens in ${result.inputTokens} / out ${result.outputTokens}${result.costUsd === null ? '' : `, $${result.costUsd.toFixed(4)}`}]`,
        report: { usage: { costUsd: result.costUsd, inputTokens: result.inputTokens, outputTokens: result.outputTokens, turns: result.turns } },
      });
    });
  });
}
