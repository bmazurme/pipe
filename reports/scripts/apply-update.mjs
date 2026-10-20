// Applies a release that the running reports has already downloaded, verified and unpacked (updates/apply.ts): copies its
// files over the install, installs dependencies, rebuilds, and puts everything back if any step fails. It runs as its OWN
// process, never inside the server: in watch mode (`npm start`) the server restarts the moment its first source file
// changes, which would kill an update running in it half-way. Plain Node with no dependencies — it must work while
// node_modules is being replaced.
//
// What an update never overwrites (kept as it is when present, created from the release only when missing):
//   · any `.env` / `.env.<name>` (the `.example`/`.sample`/`.template` ones are part of the code and do update);
//   · every `.json` under reports/packages/server/src/ — settings, the dictionary, the subscription state and config, the
//     calendar (counts/props.json holds the owner's days off next to the seeded holidays);
//   · node_modules and dist (installed / rebuilt, not copied), and .git.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CODE_ROOTS = ['reports/', 'packages/protocol/'];
const RELEASE_FILE = 'reports/release.json';
const STATE_DIR = '.update';
const DATA_JSON_DIR = 'reports/packages/server/src/';
const TEMPLATE_SUFFIXES = ['.example', '.sample', '.template'];

// `relPath` is posix-style, relative to the folder that holds reports/ and packages/.
export function isPreserved(relPath) {
  const name = posix.basename(relPath);

  if (name === '.env' || (name.startsWith('.env.') && !TEMPLATE_SUFFIXES.some((suffix) => name.endsWith(suffix)))) return true;

  return relPath.startsWith(DATA_JSON_DIR) && name.endsWith('.json');
}

// A path from a release: inside the code folders, no way out of them.
export function isSafeReleasePath(relPath) {
  if (typeof relPath !== 'string' || relPath.includes('\\') || relPath.startsWith('/') || /^[a-zA-Z]:/.test(relPath)) return false;
  if (relPath.split('/').some((part) => part === '..' || part === '' || part === '.')) return false;
  if (relPath.split('/').includes('node_modules') || relPath.split('/').includes('.git')) return false;

  return CODE_ROOTS.some((root) => relPath.startsWith(root));
}

const isPackageManifest = (relPath) => /(^|\/)package(-lock)?\.json$/.test(relPath);

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(full.slice(base.length + 1).split(sep).join('/'));
  }

  return out;
}

const sameContent = (a, b) => {
  try {
    return statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
};

const readManifest = (path) => {
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf-8'));

    return typeof manifest.releaseId === 'string' ? manifest : null;
  } catch {
    return null;
  }
};

function defaultRun(command, args, cwd) {
  // shell on Windows: npm is a .cmd there, which Node refuses to spawn directly
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status !== 0) {
    throw new Error(`"${command} ${args.join(' ')}" завершилась с ошибкой (код ${result.status ?? 'неизвестен'}):\n${output.slice(-1500)}`);
  }

  return output;
}

/**
 * `installRoot` holds reports/ and packages/protocol/; `stagingDir/files/` holds the release laid out the same way.
 * `run(command, args, cwd)` throws on failure. Returns a summary; throws only when even the rollback could not finish.
 */
export function applyUpdate({
  installRoot, stagingDir, run = defaultRun, log = console.log, setStatus = () => {}, restart = () => {},
}) {
  const filesDir = join(stagingDir, 'files');
  const backupDir = join(installRoot, STATE_DIR, 'backup');
  const newManifest = readManifest(join(filesDir, RELEASE_FILE));

  if (!newManifest) throw new Error('В распакованном релизе нет reports/release.json — обновление отменено, ничего не изменено.');

  const oldManifest = readManifest(join(installRoot, RELEASE_FILE));
  const summary = { changed: [], created: [], removed: [], keptAsIs: [], manifestsChanged: false };
  const created = [];
  const touched = []; // paths that have a backup (changed or removed)

  rmSync(backupDir, { recursive: true, force: true });
  mkdirSync(backupDir, { recursive: true });

  const backup = (rel) => {
    const source = join(installRoot, rel);

    mkdirSync(dirname(join(backupDir, rel)), { recursive: true });
    copyFileSync(source, join(backupDir, rel));
    touched.push(rel);
  };

  const rollback = () => {
    for (const rel of touched) {
      mkdirSync(dirname(join(installRoot, rel)), { recursive: true });
      copyFileSync(join(backupDir, rel), join(installRoot, rel));
    }
    for (const rel of created) rmSync(join(installRoot, rel), { force: true });
  };

  try {
    const staged = walk(filesDir);

    // Every path is checked before the first file is copied: a release with one bad path changes nothing at all.
    for (const rel of staged) {
      if (!isSafeReleasePath(rel)) throw new Error(`В релизе недопустимый путь: ${rel}`);
    }

    setStatus('applying', 'Заменяю файлы…');

    for (const rel of staged) {
      if (rel === RELEASE_FILE) continue; // written last: a half-applied update must still count as outdated

      const source = join(filesDir, rel);
      const dest = join(installRoot, rel);
      const exists = existsSync(dest);

      if (isPreserved(rel) && exists) {
        summary.keptAsIs.push(rel);
        continue;
      }
      if (exists && sameContent(source, dest)) continue;

      if (exists) backup(rel);
      else created.push(rel);

      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(source, dest);
      (exists ? summary.changed : summary.created).push(rel);
      if (isPackageManifest(rel)) summary.manifestsChanged = true;
    }

    // What the previous release had and this one does not: removed, so renamed or deleted modules do not linger and get loaded.
    const kept = new Set(newManifest.files ?? []);

    for (const rel of oldManifest?.files ?? []) {
      if (kept.has(rel) || rel === RELEASE_FILE || !isSafeReleasePath(rel) || isPreserved(rel) || !existsSync(join(installRoot, rel))) continue;

      backup(rel);
      unlinkSync(join(installRoot, rel));
      summary.removed.push(rel);
      if (isPackageManifest(rel)) summary.manifestsChanged = true;
    }

    const protocolDir = join(installRoot, 'packages', 'protocol');
    const reportsDir = join(installRoot, 'reports');
    const changedIn = (prefix) => [...summary.changed, ...summary.created, ...summary.removed].some((rel) => rel.startsWith(prefix) && isPackageManifest(rel));

    if (changedIn('packages/protocol/')) {
      setStatus('installing', 'Устанавливаю зависимости protocol…');
      log('npm install в packages/protocol');
      run('npm', ['install', '--no-audit', '--no-fund'], protocolDir);
    }
    if (changedIn('reports/')) {
      setStatus('installing', 'Устанавливаю зависимости reports…');
      log('npm install в reports');
      run('npm', ['install', '--no-audit', '--no-fund'], reportsDir);
    }

    setStatus('building', 'Собираю приложение…');
    log('сборка packages/protocol, shared');
    run('npm', ['run', 'build'], protocolDir);
    run('npm', ['run', 'build', '--workspace=packages/shared'], reportsDir);
    // The built client is only there when reports runs as one process (run.cmd / run.sh); `npm start` serves it from source.
    if (existsSync(join(reportsDir, 'packages', 'client', 'dist', 'index.html'))) {
      log('сборка client');
      run('npm', ['run', 'build', '--workspace=packages/client'], reportsDir);
    }

    // The marker of the new version goes in only now.
    const manifestDest = join(installRoot, RELEASE_FILE);

    if (existsSync(manifestDest)) backup(RELEASE_FILE);
    else created.push(RELEASE_FILE);
    copyFileSync(join(filesDir, RELEASE_FILE), manifestDest);
  } catch (error) {
    log(`ОШИБКА: ${error instanceof Error ? error.message : String(error)}`);
    setStatus('rolling-back', 'Что-то пошло не так — возвращаю прежнюю версию…');
    rollback();

    // Best effort: what was rebuilt from the new sources is rebuilt again from the restored ones.
    try {
      if (summary.manifestsChanged) {
        run('npm', ['install', '--no-audit', '--no-fund'], join(installRoot, 'packages', 'protocol'));
        run('npm', ['install', '--no-audit', '--no-fund'], join(installRoot, 'reports'));
      }
      run('npm', ['run', 'build'], join(installRoot, 'packages', 'protocol'));
      run('npm', ['run', 'build', '--workspace=packages/shared'], join(installRoot, 'reports'));
      if (existsSync(join(installRoot, 'reports', 'packages', 'client', 'dist', 'index.html'))) {
        run('npm', ['run', 'build', '--workspace=packages/client'], join(installRoot, 'reports'));
      }
    } catch (rebuildError) {
      log(`после отката пересобрать не удалось: ${rebuildError instanceof Error ? rebuildError.message : String(rebuildError)}`);
    }

    const failure = new Error(error instanceof Error ? error.message : String(error));

    failure.rolledBack = true;
    throw failure;
  }

  restart();

  return { releaseId: newManifest.releaseId, ...summary };
}

// ---- command line: node apply-update.mjs --root <installRoot> --staging <dir> [--restart launcher --pid <server pid>]
function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 2) args[argv[index].replace(/^--/, '')] = argv[index + 1];

  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const installRoot = resolve(args.root ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const stagingDir = resolve(args.staging ?? '');
  const statusPath = join(installRoot, STATE_DIR, 'status.json');
  const releaseId = readManifest(join(stagingDir, 'files', RELEASE_FILE))?.releaseId ?? null;
  const startedAt = new Date().toISOString();
  const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
  const setStatus = (phase, message) => {
    mkdirSync(dirname(statusPath), { recursive: true });
    writeFileSync(statusPath, JSON.stringify({ phase, message, releaseId, startedAt, updatedAt: new Date().toISOString() }));
    log(`${phase}: ${message}`);
  };

  // In the launcher mode (run.cmd / run.sh) the launcher starts the server again once it sees this marker and the server gone.
  const restart = () => {
    if (args.restart !== 'launcher' || !args.pid) return;

    writeFileSync(join(installRoot, STATE_DIR, 'restart'), String(Date.now()));
    try {
      process.kill(Number(args.pid));
    } catch {
      // the server is already gone
    }
  };

  try {
    const summary = applyUpdate({ installRoot, stagingDir, log, setStatus, restart });
    const kept = summary.keptAsIs.length > 0 ? ` Ваши настройки не тронуты (${summary.keptAsIs.length} файл.).` : '';

    setStatus('done', `Обновлено: изменено ${summary.changed.length}, добавлено ${summary.created.length}, удалено ${summary.removed.length}.${kept}`);
    rmSync(stagingDir, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    setStatus(error?.rolledBack ? 'rolled-back' : 'failed', error?.rolledBack ? `Обновление не удалось, прежняя версия возвращена. ${message}` : message);
    process.exit(1);
  }
}
