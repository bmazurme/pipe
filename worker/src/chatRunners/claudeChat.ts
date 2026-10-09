import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { ChatHistoryEntry } from '../chatBridgeClient.js';
import { attachmentRelPath, stageAttachments } from './chatAttachments.js';
import { runClaude } from '../modelRunners/claudeRunner.js';

// `claude -p` is a single-shot, stateless invocation — there's no session to
// resume across separate chat turns (worker keeps no state between turns;
// bridge is the source of truth for history), so each call has to restate
// the whole conversation itself.
export function buildPrompt(history: ChatHistoryEntry[], staged: ReadonlySet<number> = new Set()): string {
  const transcript = history
    .map((entry) => {
      const files = (entry.attachments ?? []).map((attachment) =>
        staged.has(attachment.id)
          ? `[attached ${attachment.isImage ? 'image' : 'file'}: ${attachmentRelPath(attachment)}]`
          : `[attached ${attachment.isImage ? 'image' : 'file'} "${attachment.name}" could not be loaded]`,
      );

      return [`${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`, ...files].join('\n');
    })
    .join('\n\n');
  const hasFiles = staged.size > 0;

  return `${transcript}\n\n${
    hasFiles
      ? 'Files the user attached are in the ./attachments directory, at the paths shown in brackets. Open them with your file tools (images included) when they are relevant to the question.\n\n'
      : ''
  }Continue the conversation. Reply with only the assistant's next message — no preamble, no restating the question.`;
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
  // Fetches one attached file by id; absent when the turn has no way to (older callers).
  downloadAttachment?: (attachmentId: number) => Promise<Buffer>,
): Promise<string> {
  mkdirSync(workDir, { recursive: true });
  const turnDir = mkdtempSync(path.join(workDir, 'chat-'));

  try {
    const staged = downloadAttachment ? await stageAttachments(turnDir, history, downloadAttachment) : new Set<number>();
    const prompt = buildPrompt(history, staged);
    const result = await runClaude(turnDir, prompt, claudeModel, () => {}, proxyUrl);

    if (result.exitCode !== 0) {
      throw new Error(`claude exited with code ${result.exitCode}: ${result.output}`);
    }

    return result.output.trim();
  } finally {
    rmSync(turnDir, { recursive: true, force: true });
  }
}
