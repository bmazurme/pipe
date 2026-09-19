// The no-Docker path for running reports on a personal machine: build once,
// run the single production-mode server process (see packages/server/src/index.ts —
// it serves the built client + API on one port once packages/client/dist
// exists), and open the browser to whichever port it actually started on.
// Invoked via ../run.sh or ../run.cmd, never run directly — those check for
// Node itself first, which this script can't do before it's even running.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const reportsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(reportsRoot, 'packages', 'server');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: reportsRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`\n"${command} ${args.join(' ')}" завершилась с ошибкой — смотрите вывод выше.`);
    process.exit(result.status ?? 1);
  }
}

function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, process.platform === 'win32' ? ['', url] : [url], {
    shell: process.platform === 'win32',
    stdio: 'ignore',
    detached: true,
  }).unref();
}

if (!existsSync(join(reportsRoot, 'node_modules'))) {
  console.log('Первый запуск — устанавливаю зависимости (это займёт минуту)...');
  run('npm', ['install']);
}

console.log('Собираю приложение...');
run('npm', ['run', 'build', '--workspace=packages/shared']);
run('npm', ['run', 'build', '--workspace=packages/client']);

console.log('Запускаю сервер...');
const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: serverDir,
  env: process.env,
  shell: process.platform === 'win32',
});

let browserOpened = false;
const readyPattern = /Сервер запущен: (http:\/\/\S+)/;

server.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);

  if (!browserOpened) {
    const match = readyPattern.exec(text);
    if (match) {
      browserOpened = true;
      openBrowser(match[1]);
    }
  }
});

server.stderr.on('data', (chunk) => process.stderr.write(chunk));

server.on('exit', (code) => process.exit(code ?? 0));

// Ctrl+C in this process's own terminal should stop the server too, not
// leave it running detached in the background.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.kill(signal);
  });
}
