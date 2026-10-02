import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { ChatHistoryEntry } from '../chatBridgeClient.js';
import { runClaude } from '../modelRunners/claudeRunner.js';

// `claude -p` is a single-shot, stateless invocation — there's no session to
// resume across separate chat turns (worker keeps no state between turns;
// bridge is the source of truth for history), so each call has to restate
// the whole conversation itself.
export function buildPrompt(history: ChatHistoryEntry[]): string {
  const transcript = history
    .map((entry) => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`)
    .join('\n\n');

  return `${transcript}\n\nContinue the conversation. Reply with only the assistant's next message — no preamble, no restating the question.`;
}

// Sonnet/Opus chat turns run through the same claude CLI login Worker jobs
// use (CLAUDE_CODE_OAUTH_TOKEN or `claude login`), not a separate billed
// ANTHROPIC_API_KEY — unlike a job, a chat turn has no files of its own, so
// the working directory only exists because the CLI requires one.
export async function claudeChat(
  history: ChatHistoryEntry[],
  claudeModel: 'sonnet' | 'opus',
  workDir: string,
  proxyUrl?: string,
): Promise<string> {
  mkdirSync(workDir, { recursive: true });
  const turnDir = mkdtempSync(path.join(workDir, 'chat-'));

  try {
    const prompt = buildPrompt(history);
    const result = await runClaude(turnDir, prompt, claudeModel, () => {}, proxyUrl);

    if (result.exitCode !== 0) {
      throw new Error(`claude exited with code ${result.exitCode}: ${result.output}`);
    }

    return result.output.trim();
  } finally {
    rmSync(turnDir, { recursive: true, force: true });
  }
}
