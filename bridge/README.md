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
| `TIME_EXPORT_API_KEY` | опционально: общий ключ для интеграции с [ntlstl.time](https://github.com/bmazurme/ntlstl.time) — включает `GET /api/v1/time/export/day-offs` (bridge → ntlstl.time) и `POST /api/v1/time/import/reports` (ntlstl.time → bridge); значение сверяется с заголовком `X-Api-Key`; пусто = оба эндпоинта выключены |
| `TIME_EXPORT_USER_ID` | id пользователя, которым владеют оба эндпоинта выше |

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
