import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { describe, expect, it } from 'vitest';

import { applyUpdate, isPreserved, isSafeReleasePath } from '../../../../scripts/apply-update.mjs';

type Files = Record<string, string>;

function write(root: string, files: Files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf-8');

function setup(installed: Files, release: Files, manifest: { releaseId: string; files: string[] }, oldManifest?: { releaseId: string; files: string[] }) {
  const installRoot = mkdtempSync(join(tmpdir(), 'reports-install-'));
  const stagingDir = mkdtempSync(join(tmpdir(), 'reports-staging-'));

  write(installRoot, installed);
  if (oldManifest) write(installRoot, { 'reports/release.json': JSON.stringify(oldManifest) });
  write(join(stagingDir, 'files'), { ...release, 'reports/release.json': JSON.stringify(manifest) });

  return { installRoot, stagingDir };
}

const commands = () => {
  const calls: string[] = [];

  return { calls, run: (command: string, args: string[], cwd: string) => void calls.push(`${command} ${args.join(' ')} @${cwd.split(/[\\/]/).slice(-2).join('/')}`) };
};

describe('which files an update keeps', () => {
  it('keeps .env files and every .json of the server data, but updates package.json and the .env templates', () => {
    expect(isPreserved('reports/packages/server/.env')).toBe(true);
    expect(isPreserved('reports/packages/client/.env.local')).toBe(true);
    expect(isPreserved('reports/packages/server/.env.example')).toBe(false);
    expect(isPreserved('reports/packages/server/src/settings/settings.json')).toBe(true);
    expect(isPreserved('reports/packages/server/src/counts/props.json')).toBe(true);
    expect(isPreserved('reports/packages/server/src/subscription/subscription-config.json')).toBe(true);
    expect(isPreserved('reports/package.json')).toBe(false);
    expect(isPreserved('reports/packages/server/package.json')).toBe(false);
    expect(isPreserved('reports/packages/server/tsconfig.json')).toBe(false);
    expect(isPreserved('reports/packages/server/src/index.ts')).toBe(false);
  });

  it('refuses a release path that leaves the code folders', () => {
    expect(isSafeReleasePath('reports/packages/server/src/index.ts')).toBe(true);
    expect(isSafeReleasePath('packages/protocol/src/pack.ts')).toBe(true);
    for (const bad of ['../evil', 'reports/../../evil', '/etc/passwd', 'C:/x', 'reports\\x', 'bridge/x', 'reports//x', 'reports/node_modules/x', 'reports/.git/config']) {
      expect(isSafeReleasePath(bad), bad).toBe(false);
    }
  });
});

describe('applyUpdate', () => {
  it('replaces the code and leaves the settings, the .env and the calendar exactly as they were', () => {
    const settings = '{"gitlabUrl":"https://git.example","privateToken":"user-secret"}';
    const props = '{"2026":{"offDays":["2026-03-10"],"holidays":[]}}';
    const { installRoot, stagingDir } = setup(
      {
        'reports/packages/server/src/index.ts': 'old code',
        'reports/packages/server/src/settings/settings.json': settings,
        'reports/packages/server/src/counts/props.json': props,
        'reports/packages/server/.env': 'PORT=4100',
        'reports/package.json': '{"version":"1.0.0"}',
      },
      {
        'reports/packages/server/src/index.ts': 'new code',
        'reports/packages/server/src/settings/settings.json': '{}',
        'reports/packages/server/src/counts/props.json': '{"2026":{"offDays":[],"holidays":["2026-01-01"]}}',
        'reports/package.json': '{"version":"1.0.0"}',
      },
      { releaseId: 'new', files: ['reports/packages/server/src/index.ts'] },
    );

    const summary = applyUpdate({ installRoot, stagingDir, run: commands().run });

    expect(read(installRoot, 'reports/packages/server/src/index.ts')).toBe('new code');
    expect(read(installRoot, 'reports/packages/server/src/settings/settings.json')).toBe(settings);
    expect(read(installRoot, 'reports/packages/server/src/counts/props.json')).toBe(props);
    expect(read(installRoot, 'reports/packages/server/.env')).toBe('PORT=4100');
    expect(summary.keptAsIs.sort()).toEqual(['reports/packages/server/src/counts/props.json', 'reports/packages/server/src/settings/settings.json']);
    expect(JSON.parse(read(installRoot, 'reports/release.json')).releaseId).toBe('new');
  });

  it('creates a data file the install does not have yet from the release', () => {
    const { installRoot, stagingDir } = setup(
      { 'reports/package.json': '{}' },
      { 'reports/packages/server/src/counts/props.json': '{"seed":true}', 'reports/package.json': '{}' },
      { releaseId: 'n', files: [] },
    );

    applyUpdate({ installRoot, stagingDir, run: commands().run });

    expect(read(installRoot, 'reports/packages/server/src/counts/props.json')).toBe('{"seed":true}');
  });

  it('removes what the previous release had and this one does not — but never a file of the user\'s', () => {
    const { installRoot, stagingDir } = setup(
      {
        'reports/packages/server/src/obsolete.ts': 'gone soon',
        'reports/packages/server/src/kept.ts': 'stays',
        'reports/packages/server/src/settings/old-data.json': '{"mine":1}',
        'reports/packages/server/src/mine.txt': 'not in any release',
      },
      { 'reports/packages/server/src/kept.ts': 'stays v2' },
      { releaseId: 'n', files: ['reports/packages/server/src/kept.ts'] },
      {
        releaseId: 'o',
        files: [
          'reports/packages/server/src/obsolete.ts',
          'reports/packages/server/src/kept.ts',
          'reports/packages/server/src/settings/old-data.json',
        ],
      },
    );

    const summary = applyUpdate({ installRoot, stagingDir, run: commands().run });

    expect(existsSync(join(installRoot, 'reports/packages/server/src/obsolete.ts'))).toBe(false);
    expect(summary.removed).toEqual(['reports/packages/server/src/obsolete.ts']);
    // A data file stays even when the old release listed it; a file no release ever had is not touched.
    expect(read(installRoot, 'reports/packages/server/src/settings/old-data.json')).toBe('{"mine":1}');
    expect(read(installRoot, 'reports/packages/server/src/mine.txt')).toBe('not in any release');
  });

  it('installs dependencies only where a package manifest changed, then builds', () => {
    const only = setup(
      { 'reports/packages/server/src/a.ts': 'a', 'reports/package.json': '{"v":1}' },
      { 'reports/packages/server/src/a.ts': 'b', 'reports/package.json': '{"v":1}' },
      { releaseId: 'n', files: [] },
    );
    const none = commands();
    applyUpdate({ ...only, run: none.run });

    expect(none.calls.some((call) => call.startsWith('npm install'))).toBe(false);
    expect(none.calls.map((call) => call.split(' @')[0])).toEqual(['npm run build', 'npm run build --workspace=packages/shared']);

    const changed = setup(
      { 'reports/package.json': '{"v":1}', 'packages/protocol/package.json': '{"v":1}' },
      { 'reports/package.json': '{"v":2}', 'packages/protocol/package.json': '{"v":2}' },
      { releaseId: 'n', files: [] },
    );
    const both = commands();
    applyUpdate({ ...changed, run: both.run });

    expect(both.calls.map((call) => call.split(' @')[0])).toEqual([
      'npm install --no-audit --no-fund',
      'npm install --no-audit --no-fund',
      'npm run build',
      'npm run build --workspace=packages/shared',
    ]);
    expect(both.calls[0]).toContain('packages/protocol');
    expect(both.calls[1]).toContain('/reports');
  });

  it('rebuilds the client only when it is built here (run.cmd / run.sh), not for `npm start`', () => {
    const built = setup(
      { 'reports/packages/client/dist/index.html': '<html>', 'reports/packages/server/src/a.ts': 'a' },
      { 'reports/packages/server/src/a.ts': 'b' },
      { releaseId: 'n', files: [] },
    );
    const withClient = commands();
    applyUpdate({ ...built, run: withClient.run });

    expect(withClient.calls.map((call) => call.split(' @')[0])).toContain('npm run build --workspace=packages/client');
  });

  it('puts every file back and reports it when a step fails — the new version marker is not written', () => {
    const { installRoot, stagingDir } = setup(
      {
        'reports/packages/server/src/index.ts': 'old code',
        'reports/packages/server/src/obsolete.ts': 'old module',
        'reports/packages/server/src/settings/settings.json': '{"mine":1}',
      },
      { 'reports/packages/server/src/index.ts': 'new code', 'reports/packages/server/src/brand-new.ts': 'new file' },
      { releaseId: 'new', files: ['reports/packages/server/src/index.ts', 'reports/packages/server/src/brand-new.ts'] },
      { releaseId: 'old', files: ['reports/packages/server/src/index.ts', 'reports/packages/server/src/obsolete.ts'] },
    );
    const statuses: string[] = [];
    let builds = 0;
    const run = (command: string, args: string[]) => {
      if (args.includes('--workspace=packages/shared')) {
        builds += 1;
        // fails the first time (the new sources), works for the rebuild after the rollback
        if (builds === 1) throw new Error('tsc: error TS2345');
      }
      void command;
    };

    expect(() => applyUpdate({ installRoot, stagingDir, run, setStatus: (phase: string) => void statuses.push(phase) })).toThrowError(/TS2345/);

    expect(read(installRoot, 'reports/packages/server/src/index.ts')).toBe('old code');
    expect(read(installRoot, 'reports/packages/server/src/obsolete.ts')).toBe('old module');
    expect(existsSync(join(installRoot, 'reports/packages/server/src/brand-new.ts'))).toBe(false);
    expect(read(installRoot, 'reports/packages/server/src/settings/settings.json')).toBe('{"mine":1}');
    expect(JSON.parse(read(installRoot, 'reports/release.json')).releaseId).toBe('old');
    expect(statuses).toContain('rolling-back');
    // …and what was built from the new sources was built again from the restored ones.
    expect(builds).toBe(2);
  });

  it('refuses a release without its manifest, or with a path out of the install, before touching anything', () => {
    const noManifest = mkdtempSync(join(tmpdir(), 'reports-staging-'));
    const installRoot = mkdtempSync(join(tmpdir(), 'reports-install-'));
    write(installRoot, { 'reports/a.ts': 'old' });
    write(join(noManifest, 'files'), { 'reports/a.ts': 'new' });

    expect(() => applyUpdate({ installRoot, stagingDir: noManifest, run: commands().run })).toThrow(/release\.json/);
    expect(read(installRoot, 'reports/a.ts')).toBe('old');

    const evil = setup({ 'reports/a.ts': 'old' }, { 'reports/a.ts': 'new', 'bridge/evil.ts': 'x' }, { releaseId: 'n', files: [] });
    expect(() => applyUpdate({ ...evil, run: commands().run })).toThrow(/недопустимый путь/);
    // Checked up front: not even the good file of that release was copied.
    expect(read(evil.installRoot, 'reports/a.ts')).toBe('old');
    expect(existsSync(join(evil.installRoot, 'bridge/evil.ts'))).toBe(false);
  });

  it('leaves a file alone when the release has the very same content (no pointless rewrite that restarts a watcher)', () => {
    const { installRoot, stagingDir } = setup(
      { 'reports/packages/server/src/same.ts': 'same' },
      { 'reports/packages/server/src/same.ts': 'same' },
      { releaseId: 'n', files: [] },
    );

    const summary = applyUpdate({ installRoot, stagingDir, run: commands().run });

    expect(summary.changed).toEqual([]);
    expect(summary.created).toEqual([]);
  });
});
