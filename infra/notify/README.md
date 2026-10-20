# infra/notify — Telegram messages from the boards

The backup, the replica check and the auto-deploy used to say "failed" only in the journal. `notify-telegram "text"` sends the
text to your Telegram chat, and `install.sh` points those scripts at it.

- **Through the VPN.** Telegram is blocked from here. The message goes out through a throwaway `curlimages/curl` container that joins
  the shared overlay network `telegram-proxy-net` (the backend and `vpn-client` live there) and uses `http://vpn-client:1080` — the
  same path the bridge backend uses for its own notifications.
- **Secrets.** `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` in `/etc/pipe-notify.env` (root, mode 600; on white 640 `root:pi`, because the auto-deploy
  runs as `pi` — which already holds the same token in `~/.pipe/bridge.env`), copied from `~/.pipe/bridge.env` on
  white and by an ssh pipe to red — never printed. The token reaches the container as an environment variable, not on a command line,
  and is masked if it ever shows up in an error.
- **Never fails the caller.** An undeliverable message is logged to stderr and the exit status is 0: the alert path must not break
  what it reports on.
- **Quiet hours.** Like the bridge's own notifications, nothing is sent between 23:00 and 08:00 (Europe/Moscow): `notify-telegram` keeps the
  message in `/var/lib/pipe-notify` and the first call after the window — or the `pipe-notify-flush.timer` (every 10 min, set up by
  `install.sh`, runs `notify-telegram --flush`) — sends everything held as ONE digest ("🌙 Пока были тихие часы (N): …"). The window and
  zone are `NOTIFY_QUIET_HOURS` (`HH:MM-HH:MM`, or `off`) and `NOTIFY_TZ` in `/etc/pipe-notify.env`. A queue that cannot be written to
  never loses a message — it is sent at once. A digest that fails to go out stays queued for the next try.
- **Separate from the bridge's own bot traffic.** The messages do not pass through the bridge (its quiet-hours *setting* in the profile
  is not read here — the window above is the same default), so they are kept in step by configuration, not by code.

| Board | Wired | Where |
|---|---|---|
| white | `NOTIFY_CMD` | `/etc/pipe-autodeploy.env` — a release deployed / rolled back |
| white | `ALERT_CMD` | `/etc/pipe-backup.env` — a dump that failed verification, a stale backup |
| red | `ALERT_CMD` | `/etc/pipe-backup-pull.env`, `/etc/pipe-backup-s3.env` — a failed pull / S3 mirror; `/etc/pipe-standby.env` — a replica that stopped streaming |

```bash
scp -r infra/notify pi@HOST:~/ && ssh -t pi@HOST 'sudo bash ~/notify/install.sh'    # also copies the two values on white, and sets up the quiet-hours timer
sudo notify-telegram "test"                                                          # on the board
```

`test.sh` (23 checks with a fake docker, the clock injected): `bash infra/notify/test.sh`.
