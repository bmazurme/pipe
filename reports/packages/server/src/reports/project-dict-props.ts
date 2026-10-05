import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeJsonFileSync } from '@pipe/protocol';
import type { ProjectDictType } from '@reports/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDictPath = join(__dirname, 'project-dict.json');

export const getProjectDict = (): ProjectDictType => {
  return JSON.parse(readFileSync(projectDictPath, 'utf-8'));
};

// Full replace, for restoring a settings-transfer bundle.
export const setProjectDict = (projectDict: ProjectDictType): ProjectDictType => {
  writeJsonFileSync(projectDictPath, projectDict);

  return projectDict;
};

export const addProjectCode = (code: string, label: string): ProjectDictType => {
  const projectDict = getProjectDict();

  projectDict[code] = label;
  writeJsonFileSync(projectDictPath, projectDict);

  return projectDict;
};

export const removeProjectCode = (code: string): ProjectDictType => {
  const projectDict = getProjectDict();

  if (code in projectDict) {
    delete projectDict[code];
    writeJsonFileSync(projectDictPath, projectDict);
  }

  return projectDict;
};
