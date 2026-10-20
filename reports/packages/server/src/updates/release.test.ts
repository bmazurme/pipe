import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { readInstalledManifest, readInstalledRelease, readPackageVersion } from './release';

const folder = () => mkdtempSync(join(tmpdir(), 'reports-release-'));

describe('the installed release', () => {
  it('reads the build id, version and file list that bridge wrote next to package.json', () => {
    const root = folder();
    writeFileSync(
      join(root, 'release.json'),
      JSON.stringify({ releaseId: 'a'.repeat(64), shortId: 'aaaaaaaaaaaa', version: '1.4.0', sourceSha: 'abc', files: ['reports/package.json', 3] }),
    );

    expect(readInstalledManifest(root)).toEqual({
      releaseId: 'a'.repeat(64),
      shortId: 'aaaaaaaaaaaa',
      version: '1.4.0',
      sourceSha: 'abc',
      files: ['reports/package.json'],
    });
    expect(readInstalledRelease(root)).toEqual({ releaseId: 'a'.repeat(64), shortId: 'aaaaaaaaaaaa', version: '1.4.0', sourceSha: 'abc' });
  });

  it('is null for an install that carries none, or a file that is not one', () => {
    const root = folder();

    expect(readInstalledRelease(root)).toBeNull();

    writeFileSync(join(root, 'release.json'), 'not json');
    expect(readInstalledRelease(root)).toBeNull();

    writeFileSync(join(root, 'release.json'), JSON.stringify({ version: '1.0.0' }));
    expect(readInstalledRelease(root)).toBeNull();
  });

  it('falls back to a short id and no version when the manifest has only the id', () => {
    const root = folder();
    writeFileSync(join(root, 'release.json'), JSON.stringify({ releaseId: 'b'.repeat(64) }));

    expect(readInstalledRelease(root)).toMatchObject({ shortId: 'b'.repeat(12), version: null });
  });

  it("reads reports/package.json's version", () => {
    const root = folder();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'reports', version: '2.0.1' }));

    expect(readPackageVersion(root)).toBe('2.0.1');
    expect(readPackageVersion(folder())).toBeNull();
  });
});
