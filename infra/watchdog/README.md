# infra/watchdog — a watcher outside the home network and outside bridge (R9)

The Dashboard, the board agents and Telegram all live inside bridge or behind the home router. When either dies they go quiet **together**, and the one
tile that would have said so is on the page that is down (F9). Three independent layers now speak without bridge:

| Layer | Where it runs | What it does | How it reaches you |
|---|---|---|---|
| **GitHub probe** (`.github/workflows/external-probe.yml`) | GitHub, every 10 min | asks bridge's two public addresses (3 tries) | an `outage` issue (mail/app), Telegram, and **ntfy** when the secret `NTFY_URL` is set |
| **Cloud VM watcher** (`bridge-watch.sh`, this folder) | the cloud VM, every minute | the same two addresses; the API address must say `"database":true` | **ntfy** (push; optionally forwarded to e-mail), after `DEAD_AFTER_MIN` (10) minutes of silence, repeated every 6 h, and once when it is over |
| **Bridge's own heartbeat** (`EXTERNAL_HEARTBEAT_URL`, `bridge/apps/backend/src/external-heartbeat`) | inside bridge | a *healthy* bridge pings a dead-man's-switch every minute; a sick one stays silent | whatever that service uses (healthchecks.io: e-mail, ntfy, …) |

The watcher also pings **its own** heartbeat (`HEARTBEAT_URL`, a second healthchecks check) on every pass, so if the VM itself dies, that service tells you.

## Install (on the cloud VM, not on a Pi)
```bash
scp -r infra/watchdog USER@VM:/tmp/ && ssh -t USER@VM 'sudo bash /tmp/watchdog/install.sh'
ssh -t USER@VM 'sudoedit /etc/pipe-watchdog.env'          # NTFY_URL=https://ntfy.sh/<a topic nobody can guess: openssl rand -hex 12>
ssh -t USER@VM 'sudo /usr/local/lib/pipe-watchdog/bridge-watch.sh test'   # sends one message: «Сторож на … жив»
```
Subscribe to the same topic in the ntfy app on the phone. The topic is a secret (anyone who knows it can read and write it): the settings file is mode 600; never in chat or in the repository.
Remove: `sudo bash install.sh --remove`.

## Settings (`/etc/pipe-watchdog.env`)
`NTFY_URL`, `NTFY_EMAIL` (ntfy also mails every message), `HOSTS` (default: `https://bridge.ntlstl.dev/` and `https://api.bridge.ntlstl.dev/api/v1/health`), `DEAD_AFTER_MIN` (10),
`REMIND_HOURS` (6), `HEARTBEAT_URL`, `VANTAGE` (the name in the message; default the hostname).

A host is «up» when it answers HTTP 200; the readiness address must also say `"database":true` — a bridge that answers but cannot reach its database is not up.
(The frontend host answers any path with its page, so it is only asked for `/`.) Two tries, a few seconds apart. An alarm that ntfy did not take is not marked as said and is tried again on the next pass.

Tests: `bash infra/watchdog/test.sh` (fake curl and a controlled clock; in CI).
