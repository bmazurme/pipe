# План: самоулучшающийся контур pipe

Цель: замкнутый цикл, в котором pipe сам анализирует себя, ставит задачи, выполняет их, деплоит и проверяет результат. Ядро — bridge; reports работает в изолированном контуре; уведомления и подтверждения — через Telegram; код, CI и деплой — через GitHub.

## Идея

Оркестратор в bridge, человек в Telegram как предохранитель:

```
[1 Analyze] → backlog → [2 Tasks] → [3 Execute] → PR → [4 CI+Deploy+Smoke] → [5 Next cycle]
     ▲                                                                              │
     └──────────────────────────── bridge: loop controller ◄───────────────────────┘
                         Telegram: уведомления + кнопки approve/pause/rollback
```

Большая часть звеньев уже есть. Нужно добавить контроллер цикла, GitHub-провайдер и Telegram-модуль.

## Что уже есть и что нужно добавить

| Шаг | Есть | Нужно |
|---|---|---|
| 1 Анализ | Worker jobs, `IMPROVEMENTS_*.md` (сейчас вручную) | Job-тип `analyze`: claude читает репозиторий и выдаёт структурированный backlog (JSON: title, scope, risk, acceptance, дедуп по хешу) |
| 2 Задачи | Subscription в reports, но источник только GitLab | Источник-абстракция, GitHub Issues как второй провайдер. pipe живёт на GitHub, поэтому самоулучшение логичнее вести там |
| 3 Выполнение | parcel → bridge → worker/agentRunner | Worker ветку пушит и открывает PR через GitHub App или токен с минимальными правами |
| 4 Деплой и тест | `ci.yml`, `deploy-bridge.yml` (только `workflow_dispatch`), `/api/v1/health` | Деплой после merge с environment-защитой, пост-деплойный smoke, авто-`docker service rollback` при провале |
| 5 Цикл | — | Loop controller в bridge: машина состояний, бюджеты, kill-switch |

## Новые компоненты

1. **Loop controller (`bridge/.../loop`)** — NestJS-модуль, ядро. В Postgres у него:
   - сущность `LoopRun` со стадиями `analyzing → planned → executing → pr_open → ci → deploying → verifying → done/failed`;
   - таблица backlog-пунктов со статусами;
   - события пишутся из GitHub-вебхуков (`pull_request`, `workflow_run`, `deployment_status`) и из worker.
2. **Telegram-модуль (`bridge/.../telegram`)**:
   - бот на webhook с secret token и whitelist по chat_id владельца;
   - уведомления: цикл начался, backlog готов, PR открыт, CI красный, деплой прошёл или откатился;
   - inline-кнопки: approve backlog, merge, pause, rollback;
   - команды `/status`, `/pause`, `/resume`, `/next`.
3. **GitHub-интеграция**: GitHub App (или fine-grained PAT) с правами на issues, PR, contents и checks, плюс вебхуки в bridge. Мерж идёт через GitHub auto-merge при зелёных required checks.
4. **GitHub-провайдер в reports Subscription**: тот же интерфейс, что у GitLab-источника (`listAssigned`, `getIssue`, `comment`, `close`). Формат parcel не меняется.

## Изолированный контур для reports

- Отдельный Swarm-сервис reports, только `packages/server` в headless-режиме, без публичного ingress.
- Сеть internal overlay: исходящие соединения только к bridge по API-ключу (машинная авторизация `JwtOrApiKeyGuard`). Egress ограничен allowlist'ом, клиент (UI) недоступен снаружи и открывается только через VPN или SSH-туннель.
- Volume под JSON-состояние (`subscription-state.json` и остальное). Оно хранится как файлы, а не в БД, поэтому бэкапить нужно volume.
- Секреты (GitHub-токен, API-ключ bridge) живут только в Swarm secrets этого сервиса. Паттерн тот же, что у worker.

## Защита от неуправляемого цикла

- **Protected paths** (CODEOWNERS + branch protection): `.github/workflows/`, `loop/`, `telegram/`, `deploy-*`, CI-гейты. PR агента в эти пути всегда требует ручного ревью и не мержится сам.
- **Уровни автономности**: сначала approve на backlog и на каждый merge, потом автомерж для low-risk при зелёном CI и coverage-гейте, и только потом полный автомат.
- **Бюджеты**: максимум N открытых PR, M задач в цикл, лимит токенов и стоимости за сутки, пауза после K провалов подряд.
- **Kill-switch**: `/pause` в Telegram и флаг в БД, который проверяется перед каждым переходом.
- **Откат**: smoke-тест после деплоя, при провале автоматический rollback и пометка задачи `failed`, чтобы анализ не предложил её повторно без изменений.
- **Dedup и спад**: анализатор видит историю закрытых задач; если два цикла подряд не дали значимого backlog, цикл останавливается и сообщает владельцу.

## Этапы

1. **Фундамент**: Telegram-модуль (только уведомления и `/status`), GitHub-вебхуки в bridge, модель `LoopRun`.
2. **Изоляция**: вынос reports в изолированный сервис на internal-сети, проверка связки reports ↔ bridge ↔ worker.
3. **Источник задач**: GitHub-провайдер в Subscription, задачи создаются из backlog, ручной запуск цикла.
4. **Анализатор**: job `analyze`, структурированный backlog, подтверждение кнопкой в Telegram.
5. **Исполнение**: PR от worker, CI, merge с ручным approve.
6. **Деплой и верификация**: триггер деплоя после merge, smoke, авто-rollback.
7. **Замыкание**: loop controller по расписанию или событию «деплой успешен», затем бюджеты и постепенное снятие ручных approve.

Этапы 1–3 дают рабочий полуавтомат, где человек нажимает кнопки в Telegram. Этапы 4–7 постепенно убирают человека.

## Принятые решения

1. Задачи самоулучшения живут только в GitHub Issues.
2. Результат деплоится в тот же production-стек Swarm (отсюда особая важность smoke + авто-rollback).
3. На старте — approve на каждый merge.
4. Расход токенов: равномерно расходовать недельные лимиты тарифа Pro (суточный потолок = недельный / 7, учёт в loop controller).
5. reports поднимается на машине в закрытом контуре в dev-режиме и служит каналом обмена данными между bridge и закрытым контуром (а не отдельным Swarm-сервисом, как предполагалось выше).

## Статус

- Этап 1 (фундамент): реализован в bridge — модули `telegram` и `loop` (LoopRun/LoopEvent, GitHub-вебхук, Telegram-вебхук с `/status`), миграция `AddLoopRuns`.
