import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadConfig, saveConfig } from '../config.js';
import { log } from '../log.js';
import { resolveDictionaryPath } from '../paths.js';
import { loadState } from '../state.js';
import type { SyncState } from '../types.js';

export function assertProjectPaths(name: string, projectPath: string, dictionary?: string): void {
  const resolved = path.resolve(projectPath);
  if (!existsSync(resolved)) {
    throw new Error(`Project path ${resolved} does not exist (project "${name}").`);
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Project path ${resolved} is not a directory (project "${name}").`);
  }
  if (dictionary) {
    const dictionaryPath = resolveDictionaryPath(dictionary);
    if (!existsSync(dictionaryPath)) {
      throw new Error(`Dictionary file ${dictionaryPath} does not exist (project "${name}").`);
    }
  }
}

export function addCommand(name: string, projectPath: string, dictionary?: string): void {
  const config = loadConfig();

  if (config.projects.some((p) => p.name === name)) {
    throw new Error(`Project "${name}" is already tracked.`);
  }

  assertProjectPaths(name, projectPath, dictionary);

  config.projects.push({
    name,
    path: path.resolve(projectPath),
    dictionary,
  });

  saveConfig(config);
  log.info(
    `Tracking "${name}" -> ${path.resolve(projectPath)}` +
      (dictionary ? ` (dictionary: ${dictionary})` : ' (no dictionary — content passes through unchanged)'),
  );
}

export function removeCommand(name: string): void {
  const config = loadConfig();
  const before = config.projects.length;
  config.projects = config.projects.filter((p) => p.name !== name);

  if (config.projects.length === before) {
    throw new Error(`Project "${name}" is not tracked.`);
  }

  saveConfig(config);
  log.info(`Stopped tracking "${name}".`);
}

export function listCommand(options: { json?: boolean } = {}): void {
  const config = loadConfig();

  let state: SyncState = {};
  try {
    state = loadState();
  } catch (error) {
    log.warn(`Could not read sync state, showing every project as never synced: ${(error as Error).message}`);
  }

  if (options.json) {
    log.info(
      JSON.stringify(
        config.projects.map((p) => ({
          name: p.name,
          path: p.path,
          dictionary: p.dictionary ?? null,
          lastSyncedAt: state[p.name]?.lastSyncedAt ?? null,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (config.projects.length === 0) {
    log.info('No projects tracked yet. Use "sync-cli add <name> <path> [dictionary]".');
    return;
  }

  for (const project of config.projects) {
    const lastSyncedAt = state[project.name]?.lastSyncedAt;
    log.info(
      `${project.name}\t${project.path}\t${project.dictionary ?? '(no dictionary)'}\t` +
        (lastSyncedAt ? `synced ${lastSyncedAt}` : 'never synced'),
    );
  }
}
