import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChatHistoryAttachment, ChatHistoryEntry } from '../chatBridgeClient.js';

export const ATTACHMENTS_DIR = 'attachments';

// A file name from the user, made safe to use as one path segment: no directories, no
// control characters, no leading dots, bounded length — the id in front keeps names unique.
export function safeAttachmentName(attachment: Pick<ChatHistoryAttachment, 'id' | 'name'>): string {
  const base = path.basename(attachment.name.replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '_')
    .slice(-120);

  return `${attachment.id}-${cleaned || 'file'}`;
}

// Where an attachment lives, relative to the turn's working directory.
export function attachmentRelPath(attachment: Pick<ChatHistoryAttachment, 'id' | 'name'>): string {
  return `${ATTACHMENTS_DIR}/${safeAttachmentName(attachment)}`;
}

// Fetches every file in the history into <turnDir>/attachments/. Claude Code reads them from
// there (images included) when the transcript points it at a path. A file that cannot be
// fetched is reported in the prompt rather than failing the turn.
export async function stageAttachments(
  turnDir: string,
  history: ChatHistoryEntry[],
  download: (attachmentId: number) => Promise<Buffer>,
): Promise<Set<number>> {
  const staged = new Set<number>();
  const all = history.flatMap((entry) => entry.attachments ?? []);

  if (all.length === 0) return staged;

  mkdirSync(path.join(turnDir, ATTACHMENTS_DIR), { recursive: true });

  for (const attachment of all) {
    try {
      writeFileSync(path.join(turnDir, attachmentRelPath(attachment)), await download(attachment.id));
      staged.add(attachment.id);
    } catch {
      // Left out of `staged`; the transcript says it could not be loaded.
    }
  }

  return staged;
}
