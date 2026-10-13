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

Backend: `http://localhost:3002` (порт задаётся `PORT` в `apps/backend/.env`).
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

PR, который открыл Improve, может покраснеть в CI из-за того, что worker не проверил (устаревший тест, форматирование, спецификация). Поэтому bridge каждые 3 минуты смотрит открытые PR Improve: если CI красный, он запускает worker на **ветке этого PR** — тот получает снимок головного коммита и список упавших проверок (с аннотациями: файл, строка, сообщение), чинит и пушит исправление **в ту же ветку** (CI запускается заново). Ограничения: не больше двух попыток на PR, по одной на головной коммит (исправление, ничего не изменившее, не зацикливается), PR старше трёх дней, закрытые и влитые не трогаются, защищённые пути не меняются. Включено по умолчанию; переключатель — Improve → Расписания → «Автоисправление CI». Нужен тот же токен (Checks: read для причин падения, Contents: write для пуша). Об исчерпанных попытках бот пишет в Telegram.

Если PR не удалось открыть (например, у токена нет права), созданная ветка `improve/issue-N-run-M` удаляется — запуск помечается ошибкой, и в ошибке названы недостающие права токена.

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
| `VITE_API_URL` | нет | адрес backend API, который попадёт в prod-сборку фронтенда. Без него используется `http://localhost:3002` — сборка всё равно проходит, просто как заглушка |

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
| `POSTGRES_PORT` | порт Postgres (по умолчанию `5432`) |
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
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | опционально: бот для уведомлений самоулучшающегося цикла ([SELF_IMPROVEMENT_PLAN.md](../SELF_IMPROVEMENT_PLAN.md)); `TELEGRAM_CHAT_ID` — единственный чат, с которым бот говорит и от которого принимает команды |
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
