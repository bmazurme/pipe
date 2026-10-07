# bridge

Монорепозиторий (npm workspaces): backend на NestJS + frontend на React/Vite.
Из модулей перенесён только `storage` (загрузка/скачивание файлов) — `notes` не
переносился.

## Структура

```
apps/
  backend/    # NestJS: auth, oauth (Yandex), users, storage
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
| `BRIDGE_TARGET_URL` | куда браузер редиректит после логина/ошибки OAuth (адрес фронтенда) |
| `COOKIE_DOMAIN` | домен для refresh-токен куки. Задавайте **конкретный хост** API (`api.bridge.ntlstl.dev`), а не родительский домен: соседние приложения на `*.ntlstl.dev` (notes, tools, rain) — порты этого же кода и ставят свою куку с `COOKIE_DOMAIN=.ntlstl.dev`, которая долетает и сюда. Кука bridge называется `bridgeRefreshToken` именно поэтому — совпадение имён приводило к 401 «invalid signature», лечившемуся только ручной очисткой кук |
| `EMAILS` | опционально: список email через запятую — если задан, вход разрешён только им |
| `CORS_ORIGINS` | список origin'ов через запятую, которым разрешён доступ к API |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | опционально: бот для уведомлений самоулучшающегося цикла ([SELF_IMPROVEMENT_PLAN.md](../SELF_IMPROVEMENT_PLAN.md)); `TELEGRAM_CHAT_ID` — единственный чат, с которым бот говорит и от которого принимает команды |
| `TELEGRAM_WEBHOOK_SECRET` | секрет `secret_token` из `setWebhook` (`POST /api/v1/telegram/webhook`, команды `/status`, `/help`); пусто = эндпоинт отвечает 503 |
| `GITHUB_WEBHOOK_SECRET` | секрет репо-вебхука GitHub (`POST /api/v1/github/webhook`, события Pull requests + Workflow runs, HMAC по сырому телу); пусто = 503 |
| `GITHUB_CI_WORKFLOW`, `GITHUB_DEPLOY_WORKFLOW` | имена workflow (`name:`), на которые реагирует цикл; по умолчанию `CI` и `Deploy bridge` |
| `LOOP_GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BASE_BRANCH` | merge «по кнопке» в Telegram: когда CI зелёный на PR с меткой `loop`, бот присылает сообщение с кнопкой «✅ Merge». `LOOP_GITHUB_TOKEN` — fine-grained токен **только на этот репозиторий** (Pull requests RW, Contents RW, Checks R); пусто = кнопка не предлагается никогда. Все проверки повторяются в момент нажатия: PR открыт, не draft, метка `loop`, база = `GITHUB_BASE_BRANCH` (по умолчанию `main`), `head` не изменился с момента сообщения, CI зелёный, **ни один изменённый файл не в защищённых путях** (`.github/`, `bridge/deploy/`, `loop/`, `telegram/`, `autopilot.ts`, `SELF_IMPROVEMENT_PLAN.md`) — такие PR мержатся только вручную на GitHub. Squash, привязан к проверенному sha |

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
