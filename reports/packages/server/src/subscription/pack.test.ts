import { describe, it, expect } from 'vitest';

import { buildArchive, extractArchive } from './pack';

describe('buildArchive / extractArchive', () => {
  const files = [
    { relPath: 'src/a.ts', content: 'export const a = 1;' },
    { relPath: 'src/nested/b.ts', content: 'export const b = 2;' },
  ];
  const manifest = {
    issueId: '1',
    issueIid: '42',
    issueTitle: 'Fix bug',
    issueDescription: 'Details',
    projectId: 173,
    branch: 'user-20260914-42',
    createdAt: '2026-09-14T10:00:00.000Z',
  };

  it('round-trips files and the manifest through a zip archive', () => {
    const buffer = buildArchive(files, manifest);
    const { manifest: extractedManifest, files: extractedFiles } = extractArchive(buffer);

    expect(extractedManifest).toMatchObject(manifest);
    expect(extractedManifest.contentHash).toEqual(expect.any(String));
    expect(extractedFiles).toEqual(expect.arrayContaining(files));
    expect(extractedFiles).toHaveLength(files.length);
  });

  it('throws when the manifest entry is missing', () => {
    expect(() => extractArchive(Buffer.from('not a zip'))).toThrow();
  });
});
