import path from 'node:path';

import { loadConfig, saveConfig } from '../config.js';
import { log } from '../log.js';

export function addCommand(name: string, projectPath: string, dictionary?: string): void {
  const config = loadConfig();

  if (config.projects.some((p) => p.name === name)) {
    throw new Error(`Project "${name}" is already tracked.`);
  }

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

export function listCommand(): void {
  const config = loadConfig();

  if (config.projects.length === 0) {
    log.info('No projects tracked yet. Use "sync-cli add <name> <path> [dictionary]".');
    return;
  }

  for (const project of config.projects) {
    log.info(`${project.name}\t${project.path}\t${project.dictionary ?? '(no dictionary)'}`);
  }
}
