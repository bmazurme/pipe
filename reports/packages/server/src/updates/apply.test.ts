import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../settings/props', () => ({ getSettings: () => ({}) }));

import { assertSelfUpdatable, computeReleaseId, readProgress, startUpdate, unpackRelease, type ReleaseDownload } from './apply';

type Files = Record<string, string>;

// A zip the way bridge cuts it: the files, plus reports/release.json carrying their content id.
function releaseZip(files: Files, overrides: { releaseId?: string; extra?: Files } = {}) {
  const entries = new Map(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)]));
  const releaseId = overrides.releaseId ?? computeReleaseId(entries);
  const zip = new AdmZip();

  for (const [path, data] of entries) zip.addFile(path, data);
  for (const [path, text] of Object.entries(overrides.extra ?? {})) zip.addFile(path, Buffer.from(text));
  zip.addFile('reports/release.json', Buffer.from(JSON.stringify({ releaseId, version: '2.0.0', files: Object.keys(files) })));

  return { bytes: zip.toBuffer(), releaseId };
}

const download = (bytes: Buffer, over: Partial<ReleaseDownload> = {}): ReleaseDownload => ({
  bytes,
  releaseId: null,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  ...over,
});

function install({ git = false, protocol = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'reports-self-'));

  mkdirSync(join(root, 'reports'), { recursive: true });
  if (protocol) {
    mkdirSync(join(root, 'packages', 'protocol'), { recursive: true });
    writeFileSync(join(root, 'packages', 'protocol', 'package.json'), '{}');
  }
  if (git) mkdirSync(join(root, '.git'));

  return root;
}

const FILES = {
  'reports/package.json': '{"version":"2.0.0"}',
  'reports/scripts/apply-update.mjs': '// the new applier',
  'packages/protocol/package.json': '{}',
};

function deps(root: string, zip: { bytes: Buffer; releaseId: string }, over: Record<string, unknown> = {}) {
  const launches: { script: string; args: string[] }[] = [];

  return {
    launches,
    deps: {
      installRoot: root,
      download: async () => download(zip.bytes),
      latestReleaseId: async () => zip.releaseId,
      launch: (script: string, args: string[]) => void launches.push({ script, args }),
      mode: 'other' as const,
      pid: 4242,
      now: () => Date.UTC(2026, 9, 20, 9, 0, 0),
      ...over,
    },
  };
}

describe('startUpdate', () => {
  it('downloads, checks and unpacks the release outside src/, then starts the applier from the new release', async () => {
    const root = install();
    const zip = releaseZip(FILES);
    const { deps: d, launches } = deps(root, zip);

    await expect(startUpdate(d)).resolves.toEqual({ releaseId: zip.releaseId });

    const staging = join(root, '.update', 'staging');

    expect(readFileSync(join(staging, 'files', 'reports', 'package.json'), 'utf-8')).toBe('{"version":"2.0.0"}');
    expect(existsSync(join(staging, 'files', 'reports', 'release.json'))).toBe(true);
    expect(launches).toHaveLength(1);
    expect(launches[0].script).toBe(join(staging, 'files', 'reports', 'scripts', 'apply-update.mjs'));
    expect(launches[0].args).toEqual(['--root', root, '--staging', staging]);
    expect(readProgress(root, Date.UTC(2026, 9, 20, 9, 0, 1))?.phase).toBe('staged');
  });

  it('under the launcher (run.cmd / run.sh) tells the applier which server to stop so the launcher starts it again', async () => {
    const root = install();
    const { deps: d, launches } = deps(root, releaseZip(FILES), { mode: 'launcher' });

    await startUpdate(d);

    expect(launches[0].args.slice(-4)).toEqual(['--restart', 'launcher', '--pid', '4242']);
  });

  it('refuses an archive whose checksum is not the announced one', async () => {
    const root = install();
    const zip = releaseZip(FILES);
    const { deps: d, launches } = deps(root, zip, { download: async () => download(zip.bytes, { sha256: 'f'.repeat(64) }) });

    await expect(startUpdate(d)).rejects.toThrow(/Контрольная сумма/);
    expect(launches).toEqual([]);
    expect(readProgress(root)?.phase).toBe('failed');
  });

  it('refuses an archive whose content is not what its id says (altered, or another build)', async () => {
    const root = install();
    const forged = releaseZip(FILES, { releaseId: 'c'.repeat(64) });
    const { deps: d, launches } = deps(root, forged);

    await expect(startUpdate(d)).rejects.toThrow(/не соответствует идентификатору/);
    expect(launches).toEqual([]);

    const other = releaseZip(FILES);
    const { deps: d2 } = deps(root, other, { download: async () => download(other.bytes, { releaseId: 'd'.repeat(64) }) });
    await expect(startUpdate(d2)).rejects.toThrow(/другую сборку/);
  });

  it('refuses an archive with a path that leaves the code folders, and one without release.json', async () => {
    const root = install();
    const evil = releaseZip(FILES, { extra: { '../../outside.txt': 'x' } });
    await expect(startUpdate(deps(root, evil).deps)).rejects.toThrow(/недопустимый путь/);

    const bare = new AdmZip();
    bare.addFile('reports/a.ts', Buffer.from('a'));
    const bytes = bare.toBuffer();
    await expect(startUpdate(deps(root, { bytes, releaseId: 'x' }).deps)).rejects.toThrow(/нет reports\/release\.json/);
  });

  it('says there is nothing to update when no newer release is on offer', async () => {
    const root = install();
    const { deps: d } = deps(root, releaseZip(FILES), { latestReleaseId: async () => null });

    await expect(startUpdate(d)).rejects.toThrow(/обновлять нечего/);
  });

  it('refuses to start a second update while one is running — and takes a stalled one for dead', async () => {
    const root = install();
    const zip = releaseZip(FILES);
    mkdirSync(join(root, '.update'), { recursive: true });
    const status = (updatedAt: string) =>
      writeFileSync(join(root, '.update', 'status.json'), JSON.stringify({ phase: 'building', message: 'x', releaseId: 'r', startedAt: updatedAt, updatedAt }));

    status(new Date(Date.UTC(2026, 9, 20, 8, 55, 0)).toISOString());
    await expect(startUpdate(deps(root, zip).deps)).rejects.toThrow(/уже идёт/);

    status(new Date(Date.UTC(2026, 9, 20, 8, 0, 0)).toISOString());
    await expect(startUpdate(deps(root, zip).deps)).resolves.toBeDefined();
  });
});

describe('where self-update is allowed', () => {
  it('refuses a git work tree (the developer\'s own) and a folder that is not the zip layout', () => {
    expect(() => assertSelfUpdatable(install({ git: true }))).toThrow(/git pull/);
    expect(() => assertSelfUpdatable(install({ protocol: false }))).toThrow(/не из архива/);
    expect(() => assertSelfUpdatable(install())).not.toThrow();
  });

  it('is off in a Docker image — it is rebuilt, never patched', () => {
    expect(() => assertSelfUpdatable(install(), { REPORTS_SELF_UPDATE: 'off' })).toThrow(/docker compose up -d --build/);
    expect(() => assertSelfUpdatable(install(), {})).not.toThrow();
  });

  it('is checked before anything is downloaded', async () => {
    const download = vi.fn();
    const root = install({ git: true });

    await expect(startUpdate({ installRoot: root, download, latestReleaseId: async () => 'x', launch: vi.fn(), mode: 'other', pid: 1, now: Date.now })).rejects.toThrow(/git pull/);
    expect(download).not.toHaveBeenCalled();
  });
});

describe('unpackRelease', () => {
  it('keeps the files of the zip by path and ignores folders', () => {
    const { bytes } = releaseZip(FILES);

    expect([...unpackRelease(bytes).keys()].sort()).toEqual([
      'packages/protocol/package.json',
      'reports/package.json',
      'reports/release.json',
      'reports/scripts/apply-update.mjs',
    ]);
  });
});

describe('unpackRelease limits', () => {
  const zipOf = (files: Files) => {
    const zip = new AdmZip();

    for (const [path, text] of Object.entries(files)) zip.addFile(path, Buffer.from(text));

    return zip.toBuffer();
  };
  const three = zipOf({ 'reports/a.ts': 'aaaa', 'reports/b.ts': 'bbbb', 'reports/c.ts': 'cccc' });

  it('refuses an archive with more files than the entry cap', () => {
    expect(() => unpackRelease(three, { maxEntries: 2 })).toThrow(/слишком много файлов/);
  });

  it('accepts an archive with exactly as many files as the entry cap', () => {
    expect(unpackRelease(three, { maxEntries: 3 }).size).toBe(3);
  });

  it('refuses an archive one byte over the unpacked-size cap', () => {
    expect(() => unpackRelease(three, { maxUnpackedBytes: 11 })).toThrow(/слишком велик/);
  });

  it('accepts an archive whose unpacked size equals the cap', () => {
    expect(unpackRelease(three, { maxUnpackedBytes: 12 }).size).toBe(3);
  });

  it('applies the default limits when none are given', () => {
    expect(unpackRelease(three).size).toBe(3);
  });
});

describe('computeReleaseId', () => {
  it('depends on the paths and the bytes, not on the order the files come in, and ignores release.json', () => {
    const a = new Map([['reports/a.ts', Buffer.from('1')], ['reports/b.ts', Buffer.from('2')]]);
    const b = new Map([['reports/b.ts', Buffer.from('2')], ['reports/a.ts', Buffer.from('1')], ['reports/release.json', Buffer.from('{}')]]);
    const changed = new Map([['reports/a.ts', Buffer.from('1')], ['reports/b.ts', Buffer.from('3')]]);
    const renamed = new Map([['reports/a.ts', Buffer.from('1')], ['reports/c.ts', Buffer.from('2')]]);

    expect(computeReleaseId(a)).toBe(computeReleaseId(b));
    expect(computeReleaseId(a)).not.toBe(computeReleaseId(changed));
    expect(computeReleaseId(a)).not.toBe(computeReleaseId(renamed));
    expect(computeReleaseId(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the id bridge computes: the same algorithm over the same entries', () => {
    // bridge's hashContents: sha256 over (path, \0, byteLength, \0, bytes) in path order
    const entries = new Map([['packages/protocol/package.json', Buffer.from('{}')], ['reports/package.json', Buffer.from('{"v":1}')]]);
    const expected = createHash('sha256');

    for (const path of ['packages/protocol/package.json', 'reports/package.json']) {
      const data = entries.get(path)!;

      expected.update(path).update('\0').update(String(data.byteLength)).update('\0').update(data);
    }

    expect(computeReleaseId(entries)).toBe(expected.digest('hex'));
  });
});
