import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectResult, writeParcelToDir } from './jobFiles.js';
import type { ExtractedParcel } from './parcel.js';

function parcel(): ExtractedParcel {
  return {
    manifestEntry: '__sync_manifest__.json',
    manifest: { schemaVersion: 1 } as ExtractedParcel['manifest'],
    files: [
      { relPath: 'a.ts', content: 'export const a = 1;\n' },
      { relPath: 'nested/dir/b.md', content: '# b\n' },
    ],
    assets: [{ relPath: 'img/logo.png', base64: Buffer.from([0x89, 0x50, 0xff, 0x00]).toString('base64') }],
  };
}

describe('writeParcelToDir / collectResult', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobfiles-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes text files and assets into nested directories', () => {
    writeParcelToDir(dir, parcel());
    assert.equal(readFileSync(join(dir, 'nested/dir/b.md'), 'utf-8'), '# b\n');
    assert.ok(readFileSync(join(dir, 'img/logo.png')).equals(Buffer.from([0x89, 0x50, 0xff, 0x00])));
  });

  it('round-trips edits, a new text file and a new binary file', () => {
    const input = parcel();
    writeParcelToDir(dir, input);

    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(dir, 'new.txt'), 'hello');
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);
    mkdirSync(join(dir, 'out'));
    writeFileSync(join(dir, 'out/blob.bin'), binary);
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude/settings.json'), '{}');
    mkdirSync(join(dir, 'sub/node_modules/pkg'), { recursive: true });
    writeFileSync(join(dir, 'sub/node_modules/pkg/index.js'), 'module.exports = 1;');

    const { files, assets } = collectResult(dir, input);

    const byPath = new Map(files.map((f) => [f.relPath, f.content]));
    assert.equal(byPath.get('a.ts'), 'export const a = 2;\n');
    assert.equal(byPath.get('new.txt'), 'hello');
    assert.equal(byPath.get('nested/dir/b.md'), '# b\n');
    assert.ok(!byPath.has('out/blob.bin'));
    assert.ok(!byPath.has('img/logo.png'));

    assert.deepEqual(assets[0], input.assets[0]);
    assert.equal(assets.filter((a) => a.relPath === 'img/logo.png').length, 1);
    const blob = assets.find((a) => a.relPath === 'out/blob.bin');
    assert.ok(blob, 'binary file should be collected as an asset');
    assert.ok(Buffer.from(blob.base64, 'base64').equals(binary));

    const all = [...files.map((f) => f.relPath), ...assets.map((a) => a.relPath)];
    assert.ok(!all.some((p) => p.includes('.claude') || p.includes('node_modules')), all.join(', '));
  });
});
