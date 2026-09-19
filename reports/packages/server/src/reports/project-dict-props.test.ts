import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getProjectDict, addProjectCode, setProjectDict } from './project-dict-props';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDictPath = join(__dirname, 'project-dict.json');

let originalContent: string | null;

beforeEach(() => {
  originalContent = existsSync(projectDictPath) ? readFileSync(projectDictPath, 'utf-8') : null;
  writeFileSync(projectDictPath, JSON.stringify({}));
});

afterEach(() => {
  if (originalContent === null) {
    rmSync(projectDictPath, { force: true });
  } else {
    writeFileSync(projectDictPath, originalContent);
  }
});

describe('setProjectDict', () => {
  it('fully replaces the persisted dictionary', () => {
    addProjectCode('173', 'Old label');

    const result = setProjectDict({ '999': 'Imported project' });

    expect(result).toEqual({ '999': 'Imported project' });
    expect(getProjectDict()).toEqual({ '999': 'Imported project' });
  });
});
