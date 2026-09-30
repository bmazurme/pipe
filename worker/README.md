# worker

Отдельный сервис, устанавливается на сервере с Ubuntu, и опрашивает bridge
на предмет работы по двум независимым каналам:

- **Задачи** (раздел **Worker** в bridge): скачивает обезличенную посылку,
  прогоняет её через выбранную модель (Claude, GPT, DeepSeek, Qwen) и
  отправляет результат — статус и логи — обратно в bridge.
- **Чат** (раздел **Chat** в bridge, на [`@gravity-ui/aikit`](https://gravity-ui.com/ru/libraries/aikit)):
  обычный диалог с той же пятёркой моделей напрямую, без посылки и без
  редактирования файлов — отдельный, более простой путь выполнения (один
  HTTP-запрос на реплику, без цикла вызова инструментов).

Оба канала опрашиваются одним и тем же процессом/systemd-юнитом — это не
два отдельных сервиса.

## Идея

- bridge хранит только "посылки" (zip + манифест) — те же, что использует
  `sync-cli` и модуль Subscription в `reports`. Worker никогда не видит
  де-анонимизированный код: как и `sync-cli agent-runner`, он работает
  только с уже подставленными плейсхолдерами, ничего не расшифровывая
  словарём обратно.
- Зашифрованные посылки (`.enc`) worker не обрабатывает вообще — приватный
  ключ для расшифровки принадлежит только владельцу аккаунта bridge и
  сознательно не передаётся общему серверному процессу. В bridge UI такие
  посылки просто не предлагаются к выбору.
- Для задач Sonnet/Opus выполняются через уже установленный CLI `claude`
  (Claude Code) — так же, как это делает `sync-cli agent-runner`.
  GPT/DeepSeek/Qwen выполняются через собственный минимальный цикл вызова
  инструментов (`read_file`/`write_file`/`list_files`) поверх их
  OpenAI-совместимого Chat Completions API — никакого дополнительного
  Python-тулчейна на сервере не требуется, только Node.
- Для чата всё проще: одна реплика — один HTTP-запрос, без файлов и без
  инструментов. Sonnet/Opus идут напрямую в Anthropic Messages API (нужен
  отдельный `ANTHROPIC_API_KEY`, не связанный с логином `claude` CLI —
  задачи продолжают использовать именно CLI, чат его не трогает);
  GPT/DeepSeek/Qwen используют ровно ту же настройку
  (`OPENAI_API_KEY`/`DEEPSEEK_API_KEY`/`QWEN_API_KEY` и т.д.), что и задачи.

## Требования

- Ubuntu-сервер (или любой Linux) с Node.js ≥22.
- Для Sonnet/Opus: установленный и залогиненный `claude` CLI
  (`npm install -g @anthropic-ai/claude-code`, затем `claude login`), под
  тем же пользователем ОС, от которого будет запущен worker.
- Для GPT/DeepSeek/Qwen: API-ключ соответствующего провайдера.
- Персональный API-ключ bridge (Профиль → API-ключи в bridge UI) — тот же
  механизм, что уже используют `sync-cli` и `reports`.

## Установка

```bash
git clone <этот репозиторий> /opt/pipe-worker-src
cd /opt/pipe-worker-src/packages/protocol && npm install && npm run build
cd /opt/pipe-worker-src/worker && npm install && npm run build
```

`worker/package.json` подключает `@pipe/protocol` через `file:../packages/protocol`
(как и `sync`/`reports`/`bridge`) — пакет должен быть собран (`npm run build`)
до сборки `worker`.

## Настройка

Все настройки — через переменные окружения:

| Переменная | Обязательна | Описание |
|---|---|---|
| `BRIDGE_API_URL` | да | URL bridge backend, например `https://bridge.example.com` |
| `BRIDGE_API_KEY` | да | персональный API-ключ bridge (`brk_...`) |
| `POLL_INTERVAL_SEC` | нет (по умолчанию `10`) | интервал опроса bridge на новые задачи |
| `WORKER_WORK_DIR` | нет (по умолчанию `./.worker-work`) | где создаются временные рабочие директории для задач |
| `WORKER_NAME` | нет (по умолчанию hostname) | как этот процесс будет подписываться в списке задач bridge |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | ключ обязателен для GPT (задачи и чат) | по умолчанию `https://api.openai.com/v1`, модель `gpt-4o` |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | ключ обязателен для DeepSeek (задачи и чат) | по умолчанию `https://api.deepseek.com/v1`, модель `deepseek-chat` |
| `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL` | ключ обязателен для Qwen (задачи и чат) | по умолчанию OpenAI-совместимый эндпоинт DashScope, модель `qwen-plus` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | ключ обязателен для Sonnet/Opus **в чате** | по умолчанию `https://api.anthropic.com/v1`; не нужен для задач — те используют логин `claude` CLI |
| `ANTHROPIC_SONNET_MODEL` / `ANTHROPIC_OPUS_MODEL` | нет | реальные id моделей Anthropic Messages API (по умолчанию `claude-sonnet-4-5`/`claude-opus-4-1`) — CLI-алиасы `sonnet`/`opus` этим API не понимаются напрямую |

Достаточно настроить ключи только для тех моделей, которые реально
собираетесь использовать — worker стартует и без них, задача или реплика
чата с неподключённой моделью просто завершится ошибкой с понятным
сообщением вместо падения всего процесса.

## Запуск

Разово, для проверки:

```bash
cd worker
BRIDGE_API_URL=https://bridge.example.com BRIDGE_API_KEY=brk_xxx npm start
```

Постоянно, через systemd (`systemd/pipe-worker.service`):

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin pipe-worker
sudo cp -r /opt/pipe-worker-src/worker/* /opt/pipe-worker/
sudo cp /opt/pipe-worker-src/worker/systemd/pipe-worker.service /etc/systemd/system/
echo 'BRIDGE_API_URL=https://bridge.example.com' | sudo tee /opt/pipe-worker/.env
echo 'BRIDGE_API_KEY=brk_xxx' | sudo tee -a /opt/pipe-worker/.env
sudo chown -R pipe-worker:pipe-worker /opt/pipe-worker
sudo systemctl daemon-reload
sudo systemctl enable --now pipe-worker
journalctl -u pipe-worker -f
```

## Безопасность и изоляция

`claude` CLI запускается с `--dangerously-skip-permissions` (нужно для
работы без интерактивного подтверждения) — это ровно то же самое
предупреждение, что уже стоит в `sync/src/claudeRunner.ts`: процесс не
должен работать под общей/административной учётной записью ОС. Юнит
`systemd/pipe-worker.service` уже запускает worker под отдельным
непривилегированным пользователем `pipe-worker`.

Каждая задача выполняется в свежей временной директории (`WORKER_WORK_DIR`),
которая удаляется после завершения независимо от результата. У worker нет
доступа ни к одному реальному git-репозиторию и не требуется — он только
распаковывает содержимое посылки, запускает модель и упаковывает результат
обратно, без git worktree/branch (в отличие от `sync-cli agent-runner`,
у которого есть локальный клон отслеживаемого проекта).

Для GPT/DeepSeek/Qwen worker намеренно не даёт модели инструмент для
запуска shell-команд — только `read_file`/`write_file`/`list_files`. Это
меньше возможностей, чем у `claude` CLI (которому уже доверяют
`--dangerously-skip-permissions` в этом проекте), но и меньше поверхность
атаки для менее проверенного, стороннего кода выполнения инструментов.

## Разработка

```bash
npm run build   # tsc -b
npm test        # tsc -b && node --test 'dist/**/*.test.js'
```

`claudeRunner.ts` (запуск `claude` CLI через `spawn`) намеренно не покрыт
автотестами — как и в `sync`, где у одноимённого модуля тоже нет теста:
надёжно мокать потоковый вывод дочернего процесса без реального CLI даёт
немного, основная проверка — ручной прогон. Остальное (`parcel.ts`,
`providers.ts`, `chatProviders.ts`, `config.ts`, `bridgeClient.ts`,
`chatBridgeClient.ts`, `openAiCompatibleRunner.ts`,
`chatRunners/anthropicChat.ts`, `chatRunners/openAiCompatibleChat.ts`)
покрыто модульными тестами с замоканными `fetch`.
