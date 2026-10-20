# infra/scriptcheck — are this board's scripts older than the repository's?

The boards get their scripts by hand (`scp` + `install.sh`), so a fix that is merged but never copied over just sits in the
repository. That is how the uploads copy on red ran an old `uploads-pull.sh` for days and refused a normal run ("would delete 26 of
30 files") although the fix was already on `main`.

`check-scripts.sh` compares every known installed script on the board with its file on `main`
(`raw.githubusercontent.com`, the place the auto-deploy already reads the stack files from) and **tells you once**:

- `⚠️ Скрипты на <board> устарели относительно main (N): • uploads-pull.sh (установлен a1b2c3d4, в репозитории e5f6a7b8)` — with how to update;
- again every `REPEAT_HOURS` (24) while the set stays the same, at once when another script falls behind, and
- `✅ Скрипты на <board> снова актуальны` once when everything is current.

Only scripts that exist on the board are looked at (white has the auto-deploy, red the uploads copy…). The list is in the script
(installed path → path in the repository); a test checks that every repository path in it exists. It also covers the deploy scripts
that sit next to the stack files on white (`~/bridge-pi/deploy.sh`, `deploy-worker.sh`, … — `BRIDGE_PI_DIR`, default `/home/pi/bridge-pi`):
nothing installs those, they are copied (`scp infra/bridge-pi/*.sh pi@HOST:~/bridge-pi/`), and a stale `deploy-worker.sh` makes the
auto-deploy fail on newer stack files (the stack file reads `${TELEGRAM_PROXY_ALIAS}`, which only the newer script sets). A failed check never fails
anything: an unreachable GitHub is logged and nothing more.

```bash
scp -r infra/scriptcheck pi@HOST:~/ && ssh -t pi@HOST 'sudo bash ~/scriptcheck/install.sh'   # on every board; an hourly timer
sudo /usr/local/lib/pipe-scriptcheck/check-scripts.sh --status                               # what the board has, current or not
```

Settings in `/etc/pipe-scriptcheck.env`: `ALERT_CMD` (set to `/usr/local/bin/notify-telegram` when that is installed — with the quiet
hours of `infra/notify` the message waits for the morning), `OWNER`, `REPO`, `BRANCH`, `REPEAT_HOURS`.

A merged change to a script is "outdated" on every board that has it until you install it there — that is the point. The check
cannot install anything for you: copying code onto a board stays a decision.

`test.sh` (17 checks with a fake curl, the clock injected): `bash infra/scriptcheck/test.sh`.
