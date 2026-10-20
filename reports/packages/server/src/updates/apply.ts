import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import AdmZip from 'adm-zip';
import type { UpdateProgressType } from '@reports/shared';

import { isSafeReleasePath } from '../../../../scripts/apply-update.mjs';
import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings } from '../settings/props';
import { updateChecker } from './check';
import { REPORTS_ROOT } from './release';

const DOWNLOAD_TIMEOUT_MS = 180_000;
const STATE_DIR = '.update';
const MAX_ENTRIES = 20_000;
const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;
// A running update that has not said a word for this long is taken to be dead (its machine slept, its process was killed).
const STALE_AFTER_MS = 20 * 60 * 1000;
const RELEASE_FILE = 'reports/release.json';

// reports/ and packages/protocol/ sit side by side in the zip, so this folder is the parent of reports/.
export const INSTALL_ROOT = dirname(REPORTS_ROOT.replace(/[\\/]+$/, ''));

const ACTIVE_PHASES = ['downloading', 'staged', 'applying', 'installing', 'building', 'rolling-back'];

export function readProgress(installRoot: string = INSTALL_ROOT, now: number = Date.now()): UpdateProgressType | null {
  try {
    const progress = JSON.parse(readFileSync(join(installRoot, STATE_DIR, 'status.json'), 'utf-8')) as UpdateProgressType;

    if (ACTIVE_PHASES.includes(progress.phase) && now - new Date(progress.updatedAt).getTime() > STALE_AFTER_MS) {
      return { ...progress, phase: 'failed', message: 'Обновление не отвечает уже давно — считаю его прерванным. Попробуйте ещё раз.' };
    }

    return progress;
  } catch {
    return null;
  }
}

// What the files of a release hash to — the same function bridge computes it with: every path and the bytes of every file,
// in path order, release.json left out. A download that does not hash to the id it announces is not used.
export function computeReleaseId(entries: Map<string, Buffer>): string {
  const hash = createHash('sha256');

  for (const path of [...entries.keys()].filter((name) => name !== RELEASE_FILE).sort()) {
    const content = entries.get(path)!;

    hash.update(path).update('\0').update(String(content.byteLength)).update('\0').update(content);
  }

  return hash.digest('hex');
}

// The zip as a map of path → bytes, with every path checked and the size bounded (a zip can lie about what it unpacks to).
export function unpackRelease(
  zipBytes: Buffer,
  { maxEntries = MAX_ENTRIES, maxUnpackedBytes = MAX_UNPACKED_BYTES }: { maxEntries?: number; maxUnpackedBytes?: number } = {},
): Map<string, Buffer> {
  const zip = new AdmZip(zipBytes);
  const entries = new Map<string, Buffer>();
  let total = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (entries.size >= maxEntries) throw new Error('В архиве слишком много файлов — не обновляю');
    if (!isSafeReleasePath(entry.entryName)) throw new Error(`В архиве недопустимый путь: ${entry.entryName} — не обновляю`);

    // The declared size is checked before inflating; the check after it stays as a backstop, since a header can lie.
    if (total + entry.header.size > MAX_UNPACKED_BYTES) throw new Error('Распакованный архив слишком велик — не обновляю');

    const data = entry.getData();

    total += data.byteLength;
    if (total > maxUnpackedBytes) throw new Error('Распакованный архив слишком велик — не обновляю');
    entries.set(entry.entryName, data);
  }

  return entries;
}

export interface ReleaseDownload {
  bytes: Buffer;
  releaseId: string | null;
  sha256: string | null;
}

export async function downloadRelease(): Promise<ReleaseDownload> {
  const { bridgeApiUrl, bridgeApiKey, bridgeStorageApiKey } = getSettings();
  const apiKey = bridgeStorageApiKey || bridgeApiKey;

  if (!bridgeApiUrl || !apiKey) throw new Error('Обновление: укажите адрес bridge и API-ключ на странице Settings');

  const url = new URL('/api/v1/reports-release/download', new URL(bridgeApiUrl).origin);
  const response = await fetch(url, { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (!response.ok) throw new Error(`Bridge вернул ошибку ${response.status} при скачивании обновления`);

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    releaseId: response.headers.get('x-release-id'),
    sha256: response.headers.get('x-release-sha256'),
  };
}

// An update replaces files in place, which is only safe in an install that came from the zip: a git work tree is the
// developer's own (`git pull` is how that one is updated), a folder without protocol beside it is not the zip layout, and
// a Docker image is rebuilt rather than patched (REPORTS_SELF_UPDATE=off, set by its Dockerfile).
export function assertSelfUpdatable(installRoot: string = INSTALL_ROOT, env: NodeJS.ProcessEnv = process.env): void {
  if (env.REPORTS_SELF_UPDATE === 'off') {
    throw new Error('Самообновление отключено в этом запуске (Docker-образ обновляется пересборкой: docker compose up -d --build)');
  }
  if (existsSync(join(installRoot, '.git')) || existsSync(join(REPORTS_ROOT, '.git'))) {
    throw new Error('Это git-репозиторий — reports обновляется через git pull, а не самообновлением (чтобы не затереть вашу работу)');
  }
  if (!existsSync(join(installRoot, 'packages', 'protocol', 'package.json'))) {
    throw new Error('reports установлен не из архива bridge (рядом с reports/ нет packages/protocol/) — самообновление недоступно');
  }
}

export interface StartUpdateDeps {
  installRoot: string;
  download: () => Promise<ReleaseDownload>;
  latestReleaseId: () => Promise<string | null>;
  launch: (script: string, args: string[], logPath: string) => void;
  mode: 'launcher' | 'other';
  pid: number;
  now: () => number;
}

const defaultDeps = (): StartUpdateDeps => ({
  installRoot: INSTALL_ROOT,
  download: downloadRelease,
  latestReleaseId: async () => {
    const status = await updateChecker.status({ refresh: true });

    return status.updateAvailable ? (status.latest?.releaseId ?? null) : null;
  },
  launch: (script, args, logPath) => {
    mkdirSync(dirname(logPath), { recursive: true });
    const log = openSync(logPath, 'a');

    // Detached, on its own: this server may be restarted by its own file watcher the moment the first file is replaced.
    spawn(process.execPath, [script, ...args], { detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
    closeSync(log);
  },
  mode: process.env.REPORTS_LAUNCHER === '1' ? 'launcher' : 'other',
  pid: process.pid,
  now: Date.now,
});

// Downloads the newest release, checks it, unpacks it next to the install (outside src/, so no watcher notices) and hands
// it to apply-update.mjs, which runs on its own. Returns as soon as the download has started (status `downloading`); the rest
// runs in the background, its progress and any failure are in the status file. `done` settles when that chain ends and never
// rejects, so a caller may ignore it.
export async function startUpdate(overrides: Partial<StartUpdateDeps> = {}): Promise<{ releaseId: string; done: Promise<void> }> {
  const deps = { ...defaultDeps(), ...overrides };

  assertSelfUpdatable(deps.installRoot);

  const running = readProgress(deps.installRoot, deps.now());

  if (running && ACTIVE_PHASES.includes(running.phase)) throw new Error('Обновление уже идёт — дождитесь его окончания');

  const releaseId = await deps.latestReleaseId();

  if (!releaseId) throw new Error('Новой версии нет — обновлять нечего');

  const stateDir = join(deps.installRoot, STATE_DIR);
  const statusPath = join(stateDir, 'status.json');
  const setStatus = (phase: UpdateProgressType['phase'], message: string) => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statusPath, JSON.stringify({ phase, message, releaseId, startedAt: new Date(deps.now()).toISOString(), updatedAt: new Date(deps.now()).toISOString() }));
  };

  setStatus('downloading', 'Скачиваю новую версию…');

  const run = async () => {
    const download = await deps.download();

    if (download.releaseId && download.releaseId !== releaseId) throw new Error('Bridge отдал другую сборку, чем объявил, — не обновляю');
    if (download.sha256 && createHash('sha256').update(download.bytes).digest('hex') !== download.sha256) {
      throw new Error('Контрольная сумма скачанного архива не совпала — файл повреждён по дороге, не обновляю');
    }

    const entries = unpackRelease(download.bytes);

    if (!entries.has(RELEASE_FILE)) throw new Error('В архиве нет reports/release.json — не обновляю');
    if (computeReleaseId(entries) !== releaseId) throw new Error('Содержимое архива не соответствует идентификатору релиза — не обновляю');

    const stagingDir = join(stateDir, 'staging');

    rmSync(stagingDir, { recursive: true, force: true });
    for (const [path, data] of entries) {
      const destination = join(stagingDir, 'files', path);

      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, data);
    }

    // The new release's own applier when it has one; otherwise the one already installed.
    const staged = join(stagingDir, 'files', 'reports', 'scripts', 'apply-update.mjs');
    const script = existsSync(staged) ? staged : join(REPORTS_ROOT, 'scripts', 'apply-update.mjs');
    const args = ['--root', deps.installRoot, '--staging', stagingDir, ...(deps.mode === 'launcher' ? ['--restart', 'launcher', '--pid', String(deps.pid)] : [])];

    setStatus('staged', 'Новая версия скачана и проверена — применяю…');
    deps.launch(script, args, join(stateDir, 'update.log'));
  };

  const done = run().catch((error: unknown) => {
    console.error('Update error:', error);
    try {
      setStatus('failed', error instanceof Error ? error.message : String(error));
      rmSync(join(stateDir, 'staging'), { recursive: true, force: true });
    } catch (writeError) {
      console.error('Could not record the failed update:', writeError);
    }
  });

  return { releaseId, done };
}
