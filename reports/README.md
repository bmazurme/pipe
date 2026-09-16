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

Требуется Node.js 24+.

```bash
npm install
npm start
```

`npm install` разово собирает пакет `shared` (хук `postinstall`), а `npm start` пересобирает его на всякий случай и поднимает сервер и клиент параллельно — приложение запускается одной командой без дополнительных шагов.

Сервер поднимется на `http://localhost:4000`, клиент — на `http://localhost:5174`. GitLab-интеграцию (адрес, токен, ID пользователя) и данные сотрудника/компании можно настроить прямо в интерфейсе, на странице **Settings** — отдельный `.env`-файл для этого не нужен.

Если порт `4000` уже занят другим процессом, сервер выведет ошибку и завершится — задайте свободный порт через `PORT` (см. «Переменные окружения» ниже) и укажите его клиенту через `VITE_API_DOMAIN`, например `VITE_API_DOMAIN=http://localhost:4001/api` в `.env` пакета `client`.

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
* `HTTPS_PROXY` / `HTTP_PROXY` (и их варианты в нижнем регистре) — HTTP(S)-прокси для исходящих запросов к GitLab и bridge (`http://user:pass@proxy.company.com:8080`). Нужно на машинах, где прямого выхода в интернет нет и весь трафик идёт через корпоративный прокси — без этой переменной запросы к внешним API будут виснуть по таймауту. Node/`fetch` не подхватывает системные настройки прокси автоматически, поэтому переменную нужно задать явно.

Клиент, в свою очередь, читает `VITE_API_DOMAIN` (опционально, по умолчанию `http://localhost:4000/api`) — задайте её через `.env` в `packages/client`, если сервер запущен на нестандартном порту.
