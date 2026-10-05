import { readFileSync, existsSync } from 'node:fs';

import { writeJsonFileSync } from '@pipe/protocol';

import { CONFIG_PATH } from './paths.js';
import type { ProjectConfig, SyncConfig } from './types.js';

const DEFAULT_INCLUDE = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue', '**/*.json'];
const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/uploads/**',
];

const DEFAULT_CONFIG: SyncConfig = {
  bridge: { apiUrl: 'https://api.bridge.ntlstl.dev' },
  projects: [],
};

export function loadConfig(): SyncConfig {
  if (!existsSync(CONFIG_PATH)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as SyncConfig;
}

export function saveConfig(config: SyncConfig): void {
  writeJsonFileSync(CONFIG_PATH, config);
}

export function findProject(config: SyncConfig, name: string): ProjectConfig {
  const project = config.projects.find((p) => p.name === name);

  if (!project) {
    throw new Error(
      `Project "${name}" is not tracked. Run "sync-cli list" to see tracked projects, or "sync-cli add" to add it.`,
    );
  }

  return project;
}

export function projectInclude(project: ProjectConfig): string[] {
  return project.include ?? DEFAULT_INCLUDE;
}

export function projectExclude(project: ProjectConfig): string[] {
  return project.exclude ?? DEFAULT_EXCLUDE;
}
