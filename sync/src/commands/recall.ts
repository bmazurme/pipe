import * as readline from 'node:readline/promises';
import { BridgeClient } from '../bridgeClient.js';
import { loadConfig } from '../config.js';
import { log } from '../log.js';
import { formatInbox } from './inbox.js';

export interface RecallOptions {
  yes?: boolean;
}

type RecallClient = Pick<BridgeClient, 'listFiles' | 'delete'>;

export interface RecallDeps {
  client?: RecallClient;
  isTTY?: boolean;
  confirm?: (question: string) => Promise<boolean>;
  now?: () => number;
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

// Deletes issue parcels still waiting in bridge before an agent claims them.
// Only ever touches direction 'outbound' — a 'result' parcel is never deleted.
export async function recallCommand(
  projectId: string,
  iid: string,
  options: RecallOptions,
  deps: RecallDeps = {},
): Promise<void> {
  const client = deps.client ?? new BridgeClient(loadConfig().bridge.apiUrl);
  const key = `${projectId}:${iid}`;
  const files = await client.listFiles({ channel: 'issue', taskKey: key, direction: 'outbound' });

  if (files.length === 0) {
    log.info(`Nothing to recall for ${key} — it was never pushed or an agent already picked it up`);
    return;
  }

  log.info(formatInbox(files, (deps.now ?? Date.now)()));

  if (!options.yes) {
    const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!isTTY) {
      throw new Error('Refusing to delete without confirmation: no TTY, pass --yes to proceed.');
    }
    const ok = await (deps.confirm ?? askYesNo)(`Delete ${files.length} parcel(s) for ${key}? [y/N] `);
    if (!ok) {
      log.info('Aborted, nothing deleted.');
      return;
    }
  }

  for (const file of files) {
    try {
      await client.delete(file.id);
    } catch (err) {
      throw new Error(`Failed to delete parcel ${file.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log.info(`Recalled ${files.length} parcel(s) for ${key}`);
}
