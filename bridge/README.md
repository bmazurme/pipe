# bridge

Монорепозиторий (npm workspaces): backend на NestJS + frontend на React/Vite.
Из модулей перенесён только `storage` (загрузка/скачивание файлов) — `notes` не
переносился.

## Структура

```
apps/
  backend/    # NestJS: auth, oauth (Yandex, GitHub), users, storage
  frontend/   # React + Vite + Gravity UI
deploy/
  swarm/      # манифест и bootstrap-скрипт для продакшен-деплоя в Docker Swarm
```

## Быстрый старт

```bash
npm install
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
npm run dev                        # Postgres + backend + frontend одной командой
```

`npm run dev` сам поднимает Postgres (`docker compose up -d postgres`) и затем
запускает backend и frontend параллельно. Поднять только базу (например,
чтобы прогнать миграции отдельно) — `npm run dev:db`.

Backend: `http://localhost:3000` (порт задаётся `PORT` в `apps/backend/.env`).
Frontend: `http://localhost:5173`.

## Способы входа (Yandex + GitHub)

У пользователя может быть несколько способов входа (таблица `auth_identities`). В профиле → «Доступ» →
«Способы входа» каждый можно выключить или отвязать; сервер не даёт оставить аккаунт без единого
включённого способа (`409`, проверка в транзакции с блокировкой строк). Вход через выключенный способ
отклоняется (`/oauth-error?reason=disabled`).

- Аккаунт провайдера ищется по его стабильному id. Только новый аккаунт сопоставляется по **подтверждённому**
  email: он должен быть в `EMAILS` (если список задан); если у пользователя с таким email уже подключён другой
  аккаунт этого провайдера — отказ (`reason=conflict`), привязывать нужно явно.
- Привязка нового способа — только из открытой сессии (`POST /api/v1/oauth/:provider/link` → `state` + nonce-кука),
  чужой аккаунт привязать нельзя.
- Пользователи, созданные до `AddAuthIdentities`, получают запись Yandex с `providerUserId = 'legacy:<email>'`;
  при первом входе через Яндекс она заменяется настоящим id.
- `GET /api/v1/oauth/providers` отдаёт провайдеров, для которых заданы `*_ID`; остальные кнопки скрыты.

### Подключение GitHub и миграция на новую площадку

1. github.com/settings/developers → New OAuth App; callback —
   `https://api.bridge.ntlstl.dev/api/v1/oauth/github/redirect` (общий домен API: при переключении DNS
   на другую площадку настройку менять не нужно).
2. Секреты Actions (не в чат и не в коммит): `gh secret set OAUTH_GITHUB_ID`, `OAUTH_GITHUB_SECRET`,
   `BRIDGE_GITHUB_REDIRECT`. Без них деплой проходит, кнопка GitHub скрыта.
3. После деплоя: войти через Яндекс (id заменится настоящим) → профиль → «Подключить GitHub».
4. Перенос базы: `auth_identities` едет в обычном дампе вместе с `users`; на новой площадке нужны те же
   `YANDEX_*`/`GITHUB_*`, `COOKIE_DOMAIN` и redirect URI на общий домен API.
5. Проверка после переноса: вход Яндексом и GitHub; выключить один способ (второй остаётся); попытка
   выключить последний → `409`.

## Improve: автоисправление CI

Improve (`/api/v1/improve/*`) доступен только владельцу развёртывания — тому же, кому доступны Logs: список `EMAILS`, если он задан, иначе первый аккаунт. Остальные вошедшие получают 403. Расписания и автоисправление CI работают внутри bridge без HTTP, их это не затрагивает.

PR, который открыл Improve, может покраснеть в CI из-за того, что worker не проверил (устаревший тест, форматирование, спецификация). Поэтому bridge каждые 3 минуты смотрит открытые PR Improve: если CI красный, он запускает worker на **ветке этого PR** — тот получает снимок головного коммита и список упавших проверок (с аннотациями: файл, строка, сообщение), чинит и пушит исправление **в ту же ветку** (CI запускается заново). Ограничения: не больше двух попыток на PR, по одной на головной коммит (исправление, ничего не изменившее, не зацикливается), PR старше трёх дней, закрытые и влитые не трогаются, защищённые пути не меняются. Включено по умолчанию; переключатель — Improve → Расписания → «Автоисправление CI». Нужен тот же токен (Checks: read для причин падения, Contents: write для пуша). Об исчерпанных попытках бот пишет в Telegram.

Если PR не удалось открыть (например, у токена нет права), созданная ветка `improve/issue-N-run-M` удаляется — запуск помечается ошибкой, и в ошибке названы недостающие права токена.

## Dashboard

Страница «Дашборд» (`/dashboard`) показывает три плитки: **VPN** (подключения и их состояние), **Узлы** (состояние нод Docker Swarm) и **Бэкапы** (время последнего бэкапа и его размер). Плитки «Узлы» и «Бэкапы» берут данные из `GET /api/v1/dashboard/nodes` и `GET /api/v1/dashboard/backups` — только браузерная сессия (`JwtGuard`) и только владелец развёртывания (`OwnerGuard`, как Improve и Logs); остальные получают 403.

Переменные backend (все необязательны; закомментированные примеры — в `apps/backend/.env.example`):

| Переменная | По умолчанию | Что делает |
| --- | --- | --- |
| `DOCKER_PROXY_URL` | `http://docker-proxy:2375` | Адрес docker-socket-proxy, у которого читается `GET /nodes`. Значение по умолчанию совпадает с именем сервиса `docker-proxy` в `deploy/swarm/bridge-stack.yml`. |
| `BACKUP_S3_ENDPOINT` | пусто | S3-эндпоинт бакета с бэкапами; можно несколько через запятую, используется первый. Пусто → плитка «Не настроено» (это не ошибка). |
| `BACKUP_S3_BUCKET` | `bridge-backups` | Бакет, из которого читаются указатель `LATEST` (его пишет `infra/backup/mirror-s3.sh`) и `snapshots/<метка>/meta.env`. |
| `BACKUP_S3_REGION` | `garage` | Регион S3. |
| `BACKUP_S3_ACCESS_KEY_ID` | пусто | Ключ доступа. |
| `BACKUP_S3_SECRET_ACCESS_KEY` | пусто | Секретный ключ. |

Плитка «Бэкапы» считается настроенной, только если заданы `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID` и `BACKUP_S3_SECRET_ACCESS_KEY`; иначе — «Не настроено». Если они заданы, но прочитать `LATEST` не удалось, плитка показывает ошибку.

docker-proxy должен быть доступен backend по `DOCKER_PROXY_URL` и пропускать только чтение нод (`NODES=1`; контейнеры, сервисы и exec недоступны). Если прокси недоступен или ответил ошибкой, все ноды показываются как «неизвестно», а ответ содержит поле `error`.

Список нод зашит в коде: `KNOWN_HOSTNAMES` в `apps/backend/src/dashboard/nodes.service.ts` (`ubuntu-white`, `ubuntu-red`, `ubuntu-green`, `ubuntu-blue`). Нода из списка, которой нет в ответе Swarm, тоже «неизвестно». Для другого кластера список нужно поправить в коде.

## Тесты

```bash
npm test -w backend                  # Jest
npm run test:e2e -w backend          # e2e, нужен Postgres с базой `ntlstl-db-test`
npm test -w frontend                 # Vitest
```

### Интеграционный тест S3

`apps/backend/src/storage/file-store/s3-file-store.integration.spec.ts`
проверяет `S3FileStore` (`STORAGE_DRIVER=s3`) против настоящего S3 (Garage).
Без `S3_TEST_ENDPOINT` он пропускается — в том числе в CI, поэтому перед
изменением кода драйвера `s3` прогоните его вручную:

| Переменная | Назначение |
|---|---|
| `S3_TEST_ENDPOINT` | адрес S3 API, например `http://localhost:3900`; задан — тест запускается |
| `S3_TEST_BUCKET` | бакет для теста |
| `S3_TEST_KEY_ID` | access key id |
| `S3_TEST_SECRET` | secret access key |

```bash
S3_TEST_ENDPOINT=http://localhost:3900 S3_TEST_BUCKET=bridge-test \
S3_TEST_KEY_ID=GK... S3_TEST_SECRET=... \
  npm test -w backend -- s3-file-store.integration
```

Берите **одноразовые** бакет и ключ: тест пишет и удаляет объекты под
префиксом `int/` — не направляйте его на рабочее хранилище.

## Worker: потерянные задачи

Если worker перезапустили или он пропал посреди задачи, bridge сам завершает её с ошибкой «Worker was restarted or lost…» (через 10 минут или 3 часа тишины) и не повторяет — см. [worker/README.md](../worker/README.md#потерянные-задачи-рестарт-worker).

## CI/CD

Два workflow в `.github/workflows`:

- **`ci.yml`** — на каждый push и pull request: ESLint, сборка и тесты для
  backend и frontend по отдельности. Не требует секретов (кроме опционального
  `VITE_API_URL` — без него сборка фронтенда использует заглушку).
- **`build.yml`** — на push в `main` и при создании release: сборка Docker-
  образов backend и frontend, пуш в Yandex Container Registry, деплой в
  Docker Swarm по SSH, проверка доступности после деплоя, очистка старых
  образов на ноде.

Деплой ожидает уже поднятую ноду со Swarm. Разовая подготовка ВМ:

```bash
scp deploy/swarm/bootstrap.sh <user>@<vm>:~/
ssh <user>@<vm> 'bash ~/bootstrap.sh'
```

Скрипт инициализирует swarm (если ещё не активен), проверяет свободность
портов и доступность registry, и в конце печатает значения для секретов
`SWARM_HOST` / `SWARM_USER` / `SWARM_SSH_KNOWN_HOSTS`.

### Секреты GitHub Actions

Repo → Settings → Secrets and variables → Actions.

#### Для `ci.yml`

| Секрет | Обязателен | Назначение |
|---|---|---|
| `VITE_API_URL` | нет | адрес backend API, который попадёт в prod-сборку фронтенда. Без него используется `http://localhost:3000` — сборка всё равно проходит, просто как заглушка |

#### Для `build.yml`

**Реестр образов (Yandex Container Registry):**

| Секрет | Назначение |
|---|---|
| `YC_SA_JSON_CREDENTIALS` | JSON-ключ сервисного аккаунта для логина в реестр |
| `CR_HOST` | хост реестра, обычно `cr.yandex` |
| `CR_REGISTRY` | id реестра |
| `CR_BACKEND_IMAGE` | имя образа backend, например `bridge-backend` |
| `CR_FRONTEND_IMAGE` | имя образа frontend, например `bridge-frontend` |

**Доступ к Swarm-ноде по SSH:**

| Секрет | Назначение |
|---|---|
| `SWARM_HOST` | адрес VM со swarm-менеджером |
| `SWARM_USER` | пользователь SSH на VM |
| `SWARM_SSH_KEY` | приватный SSH-ключ (публичная половина — в `~/.ssh/authorized_keys` на VM) |
| `SWARM_SSH_KNOWN_HOSTS` | host key VM; без него — `ssh-keyscan` на каждый прогон (TOFU) |

**Окружение backend в проде** (значения из `apps/backend/.env.example`, но
реальные секреты, не дефолты для разработки):

| Секрет | Назначение |
|---|---|
| `POSTGRES_HOST` | адрес Postgres, доступный со Swarm-ноды (не `localhost` и не имя compose-сервиса — swarm-таск не резолвит короткие имена) |
| `POSTGRES_PORT` | порт Postgres (`5445` для локального docker-compose, `5432` внутри сети Swarm) |
| `POSTGRES_USER` | пользователь Postgres |
| `POSTGRES_PASSWORD` | пароль Postgres |
| `POSTGRES_DB` | имя базы |
| `JWT_SECRET` | секрет для access-токенов |
| `REFRESH_JWT_SECRET` | секрет для refresh-токенов |
| `YANDEX_ID` | client ID приложения на oauth.yandex.ru |
| `YANDEX_SECRET` | client secret приложения на oauth.yandex.ru |
| `BRIDGE_YANDEX_REDIRECT` | callback URL, зарегистрированный в приложении на oauth.yandex.ru (`https://<backend-host>/api/v1/oauth/yandex/redirect`) |
| `GITHUB_ID` / `GITHUB_SECRET` | опционально: OAuth App на github.com/settings/developers — второй способ входа. Пусто — кнопка «Войти через GitHub» скрыта. В GitHub Actions секреты называются `OAUTH_GITHUB_ID` / `OAUTH_GITHUB_SECRET` (имя секрета не может начинаться с `GITHUB_`) |
| `BRIDGE_GITHUB_REDIRECT` | callback URL приложения GitHub (`https://<backend-host>/api/v1/oauth/github/redirect`); адрес общий для обеих площадок, при переключении DNS его менять не нужно |
| `BRIDGE_TARGET_URL` | куда браузер редиректит после логина/ошибки OAuth (адрес фронтенда) |
| `COOKIE_DOMAIN` | домен для refresh-токен куки. Задавайте **конкретный хост** API (`api.bridge.ntlstl.dev`), а не родительский домен: соседние приложения на `*.ntlstl.dev` (notes, tools, rain) — порты этого же кода и ставят свою куку с `COOKIE_DOMAIN=.ntlstl.dev`, которая долетает и сюда. Кука bridge называется `bridgeRefreshToken` именно поэтому — совпадение имён приводило к 401 «invalid signature», лечившемуся только ручной очисткой кук |
| `EMAILS` | опционально: список email через запятую — если задан, вход разрешён только им |
| `CORS_ORIGINS` | список origin'ов через запятую, которым разрешён доступ к API |
| `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | опционально: хранилище загруженных файлов — `local` (по умолчанию, том) или `s3`; при `s3` все, кроме `S3_REGION`, обязательны, иначе backend не стартует. Подробности: [docs/deploy.md](../docs/deploy.md#file-storage) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | опционально: бот для уведомлений самоулучшающегося цикла ([SELF_IMPROVEMENT_PLAN.md](../SELF_IMPROVEMENT_PLAN.md)); `TELEGRAM_CHAT_ID` — единственный чат, с которым бот говорит и от которого принимает команды |
| `LIMIT_ALERTS` | опционально: `off` выключает Telegram-предупреждения о лимитах плана Claude (окно токена или worker'а перешло 80 % / 95 % или отклонено — одно сообщение на уровень и окно; тихие часы `NOTIFY_QUIET_HOURS` соблюдаются). По умолчанию включены |
| `VPN_ALERTS` | опционально: `off` выключает Telegram-предупреждения о недоступности VPN-подключения (активного или проверяемого вручную) — одно сообщение при падении, ещё одно когда панель снова отвечает; не на каждый опрос. По умолчанию включены |
| `TELEGRAM_WEBHOOK_SECRET` | секрет `secret_token` из `setWebhook` (`POST /api/v1/telegram/webhook`, команды `/status`, `/help`); пусто = эндпоинт отвечает 503 |
| `GITHUB_WEBHOOK_SECRET` | секрет репо-вебхука GitHub (`POST /api/v1/github/webhook`, события Pull requests + Workflow runs, HMAC по сырому телу); пусто = 503 |
| `GITHUB_CI_WORKFLOW`, `GITHUB_DEPLOY_WORKFLOW` | имена workflow (`name:`), на которые реагирует цикл; по умолчанию `CI` и `Deploy bridge` |
| `LOOP_GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BASE_BRANCH` | merge «по кнопке» в Telegram: когда CI зелёный на PR с меткой `loop`, бот присылает сообщение с кнопкой «✅ Merge». `LOOP_GITHUB_TOKEN` — fine-grained токен **только на этот репозиторий** (Issues RW, Pull requests RW, Contents RW, Checks R, плюс Metadata R — он выдаётся автоматически; Issues, Pull requests и Contents нужны и Improve — запуски, анализ и автозавод issues используют тот же токен. Если в Profile → Logs видно `GitHub 403: Resource not accessible by personal access token` — токену не хватает права (например Issues или Pull requests: write): исправьте Repository permissions токена на GitHub, пересоздавать его не нужно); пусто = кнопка не предлагается никогда. Все проверки повторяются в момент нажатия: PR открыт, не draft, метка `loop`, база = `GITHUB_BASE_BRANCH` (по умолчанию `main`), `head` не изменился с момента сообщения, CI зелёный, **ни один изменённый файл не в защищённых путях** (`.github/`, `bridge/deploy/`, `loop/`, `telegram/`, `autopilot.ts`, `SELF_IMPROVEMENT_PLAN.md`) — такие PR мержатся только вручную на GitHub. Squash, привязан к проверенному sha |

**Сборка frontend:**

| Секрет | Назначение |
|---|---|
| `VITE_API_URL` | адрес backend API, вшивается в prod-бандл на этапе сборки (тот же секрет, что и в `ci.yml`) |

**Опционально:**

| Секрет | Назначение |
|---|---|
| `BACKEND_PUBLISHED_PORT` | порт backend на VM (по умолчанию `3300`) |
| `FRONTEND_PUBLISHED_PORT` | порт frontend на VM (по умолчанию `3305`) |
| `HOST` | публичный URL приложения — если задан, после деплоя проверяется через реверс-прокси (8 последовательных запросов, ожидается `200`) |

Дефолты `3300`/`3305` выбраны по занятости портов на целевой ноде на момент
настройки: `3000`/`3005` (places), `3400`/`3405` (tools), `3450`/`3455`
(notes), `3600`/`3605` (rain), `8080` (pgadmin). Перед деплоем на другую ноду
сверьтесь с `docker ps` / `docker stack ls`, чтобы не столкнуться с чужим
стеком.

Значения `BRIDGE_YANDEX_REDIRECT` и `BRIDGE_TARGET_URL` — без кавычек, `docker
stack deploy` их не снимает.
