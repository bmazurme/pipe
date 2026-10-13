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
- **Separate from the bridge's own bot traffic.** The backend's quiet hours and digest do not apply here: these are rare, important
  messages and are sent at once.

| Board | Wired | Where |
|---|---|---|
| white | `NOTIFY_CMD` | `/etc/pipe-autodeploy.env` — a release deployed / rolled back |
| white | `ALERT_CMD` | `/etc/pipe-backup.env` — a dump that failed verification, a stale backup |
| red | `ALERT_CMD` | `/etc/pipe-backup-pull.env`, `/etc/pipe-backup-s3.env` — a failed pull / S3 mirror; `/etc/pipe-standby.env` — a replica that stopped streaming |

```bash
scp -r infra/notify pi@HOST:~/ && ssh -t pi@HOST 'sudo bash ~/notify/install.sh'    # also copies the two values on white
sudo notify-telegram "test"                                                          # on the board
```

`test.sh` (12 checks with a fake docker): `bash infra/notify/test.sh`.
