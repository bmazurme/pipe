# End-to-end test: closed-contour auto-pull

Verifies the stage-2 link of [SELF_IMPROVEMENT_PLAN.md](../SELF_IMPROVEMENT_PLAN.md):
reports (running unattended, `REPORTS_AUTOPILOT=true`) heartbeats to bridge and
pulls a ready result parcel into the task branch by itself, reporting to Telegram.

## Setup (done once)

- Sandbox repo `~/pipe-e2e-sandbox/repo` with a local bare `origin.git`, so
  nothing real is touched. It contains `src/hello.ts` and `src/config.json`,
  both mentioning `Acme Corp`.
- reports: tracked project `9001` → the sandbox repo; dictionary entry
  `Acme Corp` ↔ `COMPANY_X`; a manual task `E2E: add farewell()`.

To recreate it from scratch: make a repo + bare origin, add it in reports
Settings → Отслеживаемые репозитории (id `9001`, base branch `main`), add the
dictionary entry, then create a manual task for project 9001.

## Run

1. **Contour up.** reports server started with `REPORTS_AUTOPILOT=true` in
   `reports/packages/server/.env` (log line `Autopilot: on`). Telegram:
   `🟢 reports «<hostname>» онлайн`; `/status` lists it.
2. **Push.** In the reports UI → Subscription, open the manual task and push.
   The draft must show `COMPANY_X`, never `Acme Corp`. Step becomes `pushed`.
3. **Produce a result** — either:
   - free, instant: from `reports/packages/server`
     `npx tsx --env-file=.env scripts/fake-result-parcel.ts 9001:<iid>`
   - real: bridge → Worker page, create a job from the parcel (sonnet), wait.
4. **Wait ≤ 30 s.** Telegram: `⬇️ Результат по 9001:<iid> загружен в ветку <branch>`.

## Verify

```sh
cd ~/pipe-e2e-sandbox/repo
git branch --show-current          # the task branch
git log --oneline -2               # "Pull issue #<iid>: …" on top
grep -r "Acme Corp" src/farewell.ts   # real value restored (no COMPANY_X)
git ls-remote ../origin.git        # task branch pushed
git rev-parse main origin/main     # main untouched
```

reports UI: task step is `pulled`; the parcel is gone from bridge storage.

## Failure path

Dirty the sandbox (`echo x >> src/hello.ts`), push the task again, upload a
fake result. Expect `⚠️ Не удалось загрузить результат …` once, the parcel left
on bridge, and no repeat for 10 minutes. `git checkout .` and restart reports
(or wait) to see it succeed.

## Offline alert

Stop reports. After ~1–1.5 min: `🔴 reports «<hostname>» оффлайн`. Start it:
`🟢 … онлайн`.

## Cleanup

Delete the task in the UI, remove the tracked project and dictionary entry,
`rm -rf ~/pipe-e2e-sandbox`.

## Variant: task from a GitHub issue (stage 3)

1. `reports/packages/server/.env`: `GITHUB_TOKEN=…` (e.g. `$(gh auth token)` for a local check), restart reports.
2. Settings → Отслеживаемые репозитории → add: «или GitHub репозиторий» = `bmazurme/pipe`, local path = the sandbox repo (the code the task is run against), base branch `main`.
3. Create a task: `gh issue create -R bmazurme/pipe -l loop -t "E2E: add farewell()" -b "Add an exported farewell(name) function next to greet() in src/hello.ts."`
4. Subscription page: the issue appears with its repo name. Init → Push (draft anonymized) → worker → autopilot pulls → Publish leaves a comment on the issue.
5. Close the issue and remove the tracked repo afterwards.

## Variant: analysis → backlog → issues (stage 4)

1. Subscription → «Запустить анализ». A task `Analysis <date>` appears (branch already created).
2. Open it → Push → worker job (Worker page) → the autopilot pulls the result.
3. Open the task again: «Предложения анализа» lists what Claude proposed. Duplicates of existing `loop` issues are marked and can't be ticked.
4. Tick items → «Создать issues». GitHub issues appear with labels `loop` + `risk:<level>`; Telegram: `📝 Из анализа … создано задач в GitHub: N`.
5. Check the branch only contains `loop-backlog.json` (`git diff main <branch> --stat`). Delete the analysis branch afterwards — it is a throwaway artifact, never to be merged.

