import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildProjectZip, deriveZipName } from './projectZip';

function fileAt(path: string, content: BlobPart): File {
  const name = path.split('/').pop() ?? path;
  const file = new File([content], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
  return file;
}

async function unzip(blob: Blob): Promise<Record<string, Uint8Array>> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  return unzipSync(buffer);
}

describe('buildProjectZip', () => {
  it('excludes build/vcs folders and .env files, keeps .env.example', async () => {
    const files = [
      fileAt('proj/src/index.ts', 'const x = 1;'),
      fileAt('proj/node_modules/pkg/index.js', 'module.exports = {}'),
      fileAt('proj/.git/config', '[core]'),
      fileAt('proj/dist/bundle.js', 'console.log(1)'),
      fileAt('proj/build/out.js', 'console.log(1)'),
      fileAt('proj/.next/cache.bin', 'x'),
      fileAt('proj/coverage/lcov.info', 'x'),
      fileAt('proj/.env', 'SECRET=1'),
      fileAt('proj/.env.local', 'SECRET=1'),
      fileAt('proj/.env.example', 'SECRET='),
    ];

    const result = await buildProjectZip(files, new Map(), () => {});
    const entries = await unzip(result.blob);

    expect(Object.keys(entries).sort()).toEqual(
      ['proj/.env.example', 'proj/src/index.ts'].sort(),
    );
    expect(result.fileCount).toBe(2);
    expect(result.excludedCount).toBe(8);
  });

  it('applies the purge dictionary to text files and counts replacements', async () => {
    const files = [fileAt('proj/src/config.ts', 'const token = "secret";')];
    const dictionary = new Map([['secret', 'REDACTED']]);

    const result = await buildProjectZip(files, dictionary, () => {});
    const entries = await unzip(result.blob);

    expect(new TextDecoder().decode(entries['proj/src/config.ts'])).toBe(
      'const token = "REDACTED";',
    );
    expect(result.replacedCount).toBe(1);
  });

  it('leaves binary files untouched', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const files = [fileAt('proj/assets/logo.png', bytes)];

    const result = await buildProjectZip(files, new Map([['secret', 'x']]), () => {});
    const entries = await unzip(result.blob);

    expect(entries['proj/assets/logo.png']).toEqual(bytes);
  });

  it('reports progress reaching 1 after the last file', async () => {
    const files = [fileAt('proj/a.ts', 'a'), fileAt('proj/b.ts', 'b')];
    const seen: number[] = [];

    await buildProjectZip(files, new Map(), (fraction) => seen.push(fraction));

    expect(seen[seen.length - 1]).toBe(1);
  });

  it('throws when every file is excluded', async () => {
    const files = [fileAt('proj/node_modules/a.js', 'x'), fileAt('proj/.env', 'x')];

    await expect(buildProjectZip(files, new Map(), () => {})).rejects.toThrow(
      'не найдено файлов',
    );
  });
});

describe('deriveZipName', () => {
  it('uses the top-level folder name from webkitRelativePath', () => {
    const files = [fileAt('my-project/src/index.ts', 'x')];
    expect(deriveZipName(files)).toBe('my-project.zip');
  });

  it('falls back to project.zip when there is no relative path', () => {
    expect(deriveZipName([])).toBe('project.zip');
  });
});
