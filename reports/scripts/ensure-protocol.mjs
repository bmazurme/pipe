// `npm install` in reports/ needs @pipe/protocol BUILT: it is a `file:../../../packages/protocol` dependency whose
// exports point at its dist/, and the first thing the postinstall does (building packages/shared) imports types from it.
// Neither a git checkout nor the zip downloaded from bridge ships dist/ (it is gitignored), so a plain `npm install` in
// reports/ used to fail with "Cannot find module '@pipe/protocol/state'". This runs first (the `preinstall` hook) and builds
// protocol once when its dist/ is missing; when it is there already (the Docker image, CI, a developer's tree) it does nothing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARKER = join('dist', 'index.js');

/**
 * Returns what it did: 'built' · 'ready' (dist/ already there) · 'missing' (no packages/protocol next to reports/).
 * `run(command, args, cwd)` must throw (or return a non-zero status) on failure.
 */
export function ensureProtocol({ reportsRoot, exists = existsSync, run = defaultRun, log = console.log }) {
  const protocolDir = resolve(reportsRoot, '..', 'packages', 'protocol');

  if (!exists(join(protocolDir, 'package.json'))) {
    log(
      `Не найдена папка packages/protocol рядом с reports/ (${protocolDir}).\n` +
        'reports зависит от неё по относительному пути — распакуйте архив целиком, а не одну папку reports/.',
    );

    return 'missing';
  }

  if (exists(join(protocolDir, MARKER))) return 'ready';

  log('Первая установка: собираю packages/protocol (нужен reports как зависимость) — это займёт минуту...');
  run('npm', ['install'], protocolDir);
  run('npm', ['run', 'build'], protocolDir);

  return 'built';
}

function defaultRun(command, args, cwd) {
  // shell on Windows: npm is a .cmd there, which Node refuses to spawn directly since 2024
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

  if (result.status !== 0) {
    throw new Error(`"${command} ${args.join(' ')}" в ${cwd} завершилась с ошибкой (код ${result.status ?? 'неизвестен'})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reportsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

  try {
    if (ensureProtocol({ reportsRoot }) === 'missing') process.exit(1);
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
