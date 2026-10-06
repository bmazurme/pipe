# reports

Веб-приложение для учёта рабочего времени: календарь с праздниками и отгулами, помесячная статистика рабочих дней/часов, отчёт по задачам GitLab с экспортом в CSV.

* **Репозиторий:** [github.com/bmazurme/ntlstl.time](https://github.com/bmazurme/ntlstl.time)

## Tech Stack

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Redux Toolkit](https://img.shields.io/badge/Redux_Toolkit-2-764ABC?logo=redux&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white)
![Cypress](https://img.shields.io/badge/Cypress-15-17202C?logo=cypress&logoColor=white)

## Возможности

* Годовой календарь с праздниками, короткими днями, выходными и дополнительными отгулами
* Добавление отгулов диапазоном дат и удаление с подтверждением прямо из интерфейса
* Помесячная статистика рабочих дней и часов с прогресс-баром до нормы
* Отчёт по задачам GitLab для выбранного пользователя: сортируемая таблица, конвертация оценок времени в часы, ежемесячный экспорт в CSV
* Настройки: адрес GitLab, приватный токен, ID пользователя, сотрудник и компания
* Справочник кодов проектов для меток отчёта — добавление через диалог, удаление с подтверждением

## Архитектура

Монорепозиторий на npm workspaces из трёх пакетов: `client` (React + Vite SPA), `server` (Express API) и `shared` (общие TypeScript-типы для контракта API).

* `packages/client/src/pages` — страницы приложения
* `packages/client/src/components` — функциональные компоненты (календарь, детали, отчёт, настройки)
* `packages/client/src/store` — Redux-стор
* `packages/client/src/hocs`, `hooks`, `utils` — общие хуки, HOC-и и утилиты
* `packages/server/src/counts` — расчёт календарной статистики по году
* `packages/server/src/reports` — интеграция с GitLab API и экспорт CSV
* `packages/server/src/settings` — хранение конфигурации и справочника проектов в JSON
* `packages/shared/src/types.ts` — общий контракт API (`StreamEvent`, `DateType`, `ReportType` и т.д.)

Клиент и сервер обмениваются данными через newline-delimited JSON (`StreamEvent`): `GET /api/counts/:year` отдаёт календарную статистику, `GET /api/reports` — список задач GitLab.

## Запуск проекта

Требуется Node.js 22+ (как и остальные пакеты монорепозитория — см. корневой `.nvmrc`).

```bash
npm install
npm start
```

`npm install` разово собирает пакет `shared` (хук `postinstall`), а `npm start` пересобирает его на всякий случай и поднимает сервер и клиент параллельно — приложение запускается одной командой без дополнительных шагов.

Сервер поднимется на `http://localhost:4000`, клиент — на `http://localhost:5174`. GitLab-интеграцию (адрес, токен, ID пользователя) и данные сотрудника/компании можно настроить прямо в интерфейсе, на странице **Settings** — отдельный `.env`-файл для этого не нужен.

Если порт `4000` уже занят другим процессом, сервер выведет ошибку и завершится — задайте свободный порт через `PORT` (см. «Переменные окружения» ниже) и укажите его клиенту через `VITE_API_DOMAIN`, например `VITE_API_DOMAIN=http://localhost:4001/api` в `.env` пакета `client`.

## Запуск на клиентской машине (не для разработки)

Раздел выше — рабочий процесс разработчика (два процесса, hot reload). Для
обычного пользователя, который просто хочет открыть приложение у себя на
компьютере, есть два способа — оба собирают клиент один раз и раздают его
тем же сервером на одном порту (`http://127.0.0.1:4000`), без отдельного
Vite dev-сервера.

### Способ 1: Docker

Нужен только установленный Docker.

```bash
docker compose up -d --build
```

Поднимет один контейнер на `127.0.0.1:4000` (наружу, за пределы машины, не
публикуется). Настройки, календарь и состояние Subscription хранятся в
именованных Docker-томах — переживают `docker compose down`/пересборку
образа. Остановить: `docker compose down` (данные остаются); удалить вместе
с данными: `docker compose down -v`.

### Способ 2: без Docker

Нужен только Node.js 22+.

```bash
./run.sh       # macOS/Linux
run.cmd        # Windows (можно просто открыть двойным щелчком)
```

Скрипт сам поставит зависимости при первом запуске, соберёт клиент и
откроет приложение в браузере. Второй раз то же самое — выполняется быстрее,
т.к. `node_modules` уже на месте. Остановить — Ctrl+C в том же терминале.

### Скрипты

| Команда | Описание |
|---------|---------|
| `npm start` | сборка `shared` + сервер и клиент параллельно (одна команда для запуска всего приложения) |
| `npm run dev` | сервер и клиент параллельно, без пересборки `shared` |
| `npm run dev:server` | только сервер (`tsx --watch`) |
| `npm run dev:client` | только клиент (Vite) |
| `npm run build --workspace=packages/shared` | сборка общих типов |
| `npm run dev --workspace=packages/shared` | сборка общих типов в watch-режиме |
| `npm run build --workspace=packages/client` | продакшен-сборка клиента |
| `npm run lint --workspace=packages/client` | ESLint по клиенту |
| `npm test --workspace=packages/client` | юнит-тесты (Vitest) |
| `npm run e2e --workspace=packages/client` | Cypress headless |
| `npm test --workspace=packages/server` | юнит-тесты сервера (Vitest) |

Пакет `shared` резолвится через `dist/`, поэтому его нужно собрать (`build`) или держать в режиме `dev` (watch) при самостоятельной разработке типов — `npm start`/`postinstall` уже делают это автоматически.

### Переменные окружения

Сервер читает следующие переменные окружения (все опциональны, задаются через `.env` в `packages/server`, не коммитится):

* `PORT` — порт сервера, по умолчанию `4000`.
* **PR после pull.** Для задачи из GitHub автопилот, забрав результат, открывает pull request из ветки задачи (`Closes #N`, заголовок как у issue) и ставит метку `loop` (сначала создаётся PR, потом метка: bridge «усыновляет» PR по метке). PR идемпотентен: уже открытый PR ветки не дублируется. Если PR трогает защищённые пути, ставится ещё `needs-human-review` и в описании перечисляются файлы. Задачи анализа и ручные задачи PR не получают. **Merge** reports никогда не делает — это отдельный шаг через bridge и Telegram. Если PR не создался, шаг задачи остаётся `pulled`, в Telegram приходит предупреждение, а PR можно создать кнопкой Publish.
* **Анализ репозитория** (кнопка «Запустить анализ» на странице Subscription, доступна, если отслеживается GitHub-репозиторий): создаёт обычную задачу `Analysis <дата>`, в описании которой лежит промпт для Claude (в него вшиты заголовки всех уже заведённых issues с меткой `loop`, открытых и закрытых, чтобы не повторяться, и список защищённых путей, которые трогать нельзя). Дальше — обычный конвейер: Push → worker → автопуллинг. Результат работы Claude — файл `loop-backlog.json` в ветке анализа. Открыв задачу, вы видите предложения (риск, описание, пометка «дубликат #N»), отмечаете нужные галочками, и только тогда создаются GitHub issues с метками `loop` и `risk:<уровень>`. Бэклог читается из ветки через `git show` без checkout; клиент передаёт только индексы, содержимое всегда берётся заново из ветки.
* `GITHUB_TOKEN` — токен GitHub для отслеживаемых репозиториев с провайдером GitHub (Settings → «Отслеживаемые репозитории» → поле «или GitHub репозиторий», формат `owner/name`). Задачи берутся из **открытых issues с меткой `loop`** (метку можно поменять в форме; PR отбрасываются), дальше работает тот же конвейер init → draft → push → pull → publish; publish оставляет комментарий в issue (оценка времени у GitHub не поддерживается). Достаточно fine-grained токена на нужный репозиторий с правами **Issues: read & write** и **Pull requests: read & write** (PR открывает автопилот). Намеренно в `.env`, а не в Settings: bundle экспорта настроек не должен возить GitHub-токен. Для локальной проверки: `GITHUB_TOKEN=$(gh auth token)`.
* `REPORTS_AUTOPILOT=true` — режим автопилота для reports, запущенного без присмотра в закрытом контуре (см. [SELF_IMPROVEMENT_PLAN.md](../SELF_IMPROVEMENT_PLAN.md)): раз в 15 с шлёт на bridge heartbeat (`POST /api/v1/clients/heartbeat` — при тишине bridge присылает в Telegram «оффлайн») и раз в 30 с проверяет, не появился ли на bridge результат для задачи в шаге `pushed`; если появился — делает то же, что кнопка Pull (de-anonymize, коммит и push **только ветки задачи**) и сообщает в Telegram. Нужны заданные в Settings адрес bridge и личный API-ключ. Неудачный pull повторяется не чаще раза в 10 минут.
* `HTTPS_PROXY` / `HTTP_PROXY` (и их варианты в нижнем регистре) — HTTP(S)-прокси для исходящих запросов к GitLab и bridge (`http://user:pass@proxy.company.com:8080`). Нужно на машинах, где прямого выхода в интернет нет и весь трафик идёт через корпоративный прокси — без этой переменной запросы к внешним API будут виснуть по таймауту. Node/`fetch` не подхватывает системные настройки прокси автоматически, поэтому переменную нужно задать явно.

Клиент, в свою очередь, читает `VITE_API_DOMAIN` (опционально, по умолчанию `http://localhost:4000/api`) — задайте её через `.env` в `packages/client`, если сервер запущен на нестандартном порту.
