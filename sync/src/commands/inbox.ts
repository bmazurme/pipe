import { BridgeClient } from '../bridgeClient.js';
import { loadConfig } from '../config.js';
import { log } from '../log.js';
import type { StoredFileResponse } from '../types.js';

export interface InboxOptions {
  channel?: string;
  direction?: string;
  json?: boolean;
}

type InboxClient = Pick<BridgeClient, 'listFiles'>;

function formatAge(createdAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  if (Number.isNaN(seconds)) return '?';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatInbox(files: StoredFileResponse[], now: number): string {
  const header = ['ID', 'NAME', 'TASK', 'DIRECTION', 'SIZE', 'AGE'];
  const rows = files.map((f) => [
    String(f.id),
    f.originalName,
    f.taskKey ?? '-',
    f.direction ?? '-',
    formatSize(f.size),
    formatAge(f.createdAt, now),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  return [header, ...rows]
    .map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd())
    .join('\n');
}

// Lists what is waiting in bridge storage without downloading — bridge
// deletes a file once downloaded, so only listFiles is ever used here.
export async function inboxCommand(
  options: InboxOptions,
  deps: { client?: InboxClient; now?: () => number } = {},
): Promise<void> {
  if (options.direction !== undefined && options.direction !== 'result' && options.direction !== 'outbound') {
    throw new Error('--direction expects "result" or "outbound".');
  }

  const client = deps.client ?? new BridgeClient(loadConfig().bridge.apiUrl);
  const files = (
    await client.listFiles({ channel: options.channel, direction: options.direction })
  ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (options.json) {
    log.info(JSON.stringify(files, null, 2));
    return;
  }

  if (files.length === 0) {
    log.info('Nothing waiting in bridge storage.');
    return;
  }

  log.info(formatInbox(files, (deps.now ?? Date.now)()));
}
