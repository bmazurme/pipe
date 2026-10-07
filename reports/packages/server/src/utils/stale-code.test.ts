import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { codeStatus, isCodeFile, newestCodeChange } from './stale-code';

function touch(file: string, whenMs: number): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'x');
  utimesSync(file, whenMs / 1000, whenMs / 1000);
}

describe('isCodeFile', () => {
  it('counts sources and built JS, not tests, typings or runtime state', () => {
    expect(isCodeFile('autopilot.ts')).toBe(true);
    expect(isCodeFile('pack.js')).toBe(true);
    expect(isCodeFile('autopilot.test.ts')).toBe(false);
    expect(isCodeFile('types.d.ts')).toBe(false);
    expect(isCodeFile('settings.json')).toBe(false);
    expect(isCodeFile('subscription-state.json')).toBe(false);
  });
});

describe('newestCodeChange / codeStatus', () => {
  const started = Date.parse('2026-10-07T10:00:00Z');

  it('is not stale while everything is older than the process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stale-code-'));
    touch(join(dir, 'a.ts'), started - 60_000);

    const status = codeStatus([dir], started);

    expect(status.stale).toBe(false);
    expect(status.newestChangeAt).toBe(new Date(started - 60_000).toISOString());
  });

  it('is stale once a code file changed after startup, including in subfolders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stale-code-'));
    touch(join(dir, 'a.ts'), started - 60_000);
    touch(join(dir, 'sub/deep/b.ts'), started + 5_000);

    expect(codeStatus([dir], started).stale).toBe(true);
  });

  it('ignores runtime JSON, test files and node_modules even when they are newer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stale-code-'));
    touch(join(dir, 'a.ts'), started - 60_000);
    touch(join(dir, 'settings.json'), started + 5_000);
    touch(join(dir, 'a.test.ts'), started + 5_000);
    touch(join(dir, 'node_modules/pkg/index.js'), started + 5_000);

    expect(codeStatus([dir], started).stale).toBe(false);
  });

  it('skips directories that do not exist and reports no change when empty', () => {
    expect(newestCodeChange(['/definitely/not/here'])).toBe(0);
    expect(codeStatus(['/definitely/not/here'], started)).toMatchObject({ stale: false, newestChangeAt: null });
  });
});
