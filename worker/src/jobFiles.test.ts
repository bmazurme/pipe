import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { changedFiles, collectResult, describeChangedFiles, writeParcelToDir } from './jobFiles.js';
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

    const { files, assets } = collectResult(dir);

    const byPath = new Map(files.map((f) => [f.relPath, f.content]));
    assert.equal(byPath.get('a.ts'), 'export const a = 2;\n');
    assert.equal(byPath.get('new.txt'), 'hello');
    assert.equal(byPath.get('nested/dir/b.md'), '# b\n');
    assert.ok(!byPath.has('out/blob.bin'));
    assert.ok(!byPath.has('img/logo.png'));

    assert.deepEqual(assets.find((a) => a.relPath === 'img/logo.png'), input.assets[0]);
    assert.equal(assets.filter((a) => a.relPath === 'img/logo.png').length, 1);
    const blob = assets.find((a) => a.relPath === 'out/blob.bin');
    assert.ok(blob, 'binary file should be collected as an asset');
    assert.ok(Buffer.from(blob.base64, 'base64').equals(binary));

    const all = [...files.map((f) => f.relPath), ...assets.map((a) => a.relPath)];
    assert.ok(!all.some((p) => p.includes('.claude') || p.includes('node_modules')), all.join(', '));
  });

  it('returns a binary the parcel brought as it is on disk now: unchanged, regenerated, or gone', () => {
    const input: ExtractedParcel = {
      ...parcel(),
      assets: [
        { relPath: 'cad/v1/hull.f3d', base64: Buffer.from([0xff, 0x01]).toString('base64') },
        { relPath: 'cad/v1/shot.png', base64: Buffer.from([0x89, 0x50, 0xff, 0x02]).toString('base64') },
        { relPath: 'cad/v1/plan_check.png', base64: Buffer.from([0x89, 0x50, 0xff, 0x03]).toString('base64') },
      ],
    };
    writeParcelToDir(dir, input);

    const regenerated = Buffer.from([0xff, 0xfe, 0x00, 0x80]);

    writeFileSync(join(dir, 'cad/v1/hull.f3d'), regenerated); // the model rebuilt it (revision 2)
    rmSync(join(dir, 'cad/v1/plan_check.png')); // and removed a picture it no longer needs

    const { assets } = collectResult(dir);
    const byPath = new Map(assets.map((asset) => [asset.relPath, Buffer.from(asset.base64, 'base64')]));

    assert.ok(byPath.get('cad/v1/hull.f3d')?.equals(regenerated), 'the regenerated file must come back, not the old one');
    assert.ok(byPath.get('cad/v1/shot.png')?.equals(Buffer.from([0x89, 0x50, 0xff, 0x02])), 'an untouched file comes back as it was');
    assert.ok(!byPath.has('cad/v1/plan_check.png'), 'a deleted file must not come back');
  });

  it('turns a binary the model replaced with text into a text file, not a stale asset', () => {
    const input: ExtractedParcel = { ...parcel(), assets: [{ relPath: 'notes.dat', base64: Buffer.from([0xff, 0xfe]).toString('base64') }] };
    writeParcelToDir(dir, input);
    writeFileSync(join(dir, 'notes.dat'), 'now plain text');

    const { files, assets } = collectResult(dir);

    assert.equal(files.find((file) => file.relPath === 'notes.dat')?.content, 'now plain text');
    assert.ok(!assets.some((asset) => asset.relPath === 'notes.dat'));
  });
});

describe('changedFiles', () => {
  it('reports added and modified files and assets, not unchanged ones', () => {
    const base = parcel();
    const collected = {
      files: [
        { relPath: 'a.ts', content: 'export const a = 2;\n' },
        { relPath: 'nested/dir/b.md', content: '# b\n' },
        { relPath: 'new.ts', content: 'x' },
      ],
      assets: [
        { relPath: 'img/logo.png', base64: base.assets[0].base64 },
        { relPath: 'img/new.png', base64: 'AAAA' },
      ],
    };
    assert.deepEqual(changedFiles(base, collected), ['a.ts', 'img/new.png', 'new.ts']);
  });

  it('detects a modified asset and returns nothing when nothing changed', () => {
    const base = parcel();
    assert.deepEqual(changedFiles(base, { files: base.files, assets: base.assets }), []);
    assert.deepEqual(changedFiles(base, { files: base.files, assets: [{ relPath: 'img/logo.png', base64: 'AAAA' }] }), ['img/logo.png']);
  });

  it('describes the list, capped at 20 names', () => {
    assert.match(describeChangedFiles([]), /no files changed/);
    const names = Array.from({ length: 23 }, (_, i) => `f${String(i).padStart(2, '0')}`);
    const line = describeChangedFiles(names);
    assert.match(line, /changed 23 files: f00,/);
    assert.match(line, /\(\+3 more\)/);
    assert.ok(!line.includes('f20'));
  });
});
