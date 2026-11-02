# infra/ups — the UPS on the Dashboard and in Telegram

The boards stand on a CyberPower UPS (the PoE switches that power them are on its outlets). Its USB cable is in **blue**, which runs NUT as
the master (`usbhid-ups` → `upsd`); white, red and green are NUT clients (`upsmon`, secondary) and shut down on blue's command. This folder adds
what NUT itself does not do:

| What | How |
|---|---|
| The Dashboard's «ИБП» tile (status, charge, runtime, load, input) | `report.sh` every minute → `POST /api/v1/boards/agent/ups` with the boards-only key of the owner, the same one `infra/boardagent` uses |
| Telegram when the power goes, comes back, the battery is nearly flat, the boards are being shut down, the USB link drops or returns, the battery wants replacing | `notify.sh` is `NOTIFYCMD` of blue's `upsmon`; it calls `notify-telegram` **with the quiet hours off** (a power cut at night is what you want to know about) |

Only the master sends the alerts, so one event is one message. `report.sh` sends nothing when `upsc` does not answer; bridge shows a missing
report as «ИБП не присылает данные» after 5 minutes.

```
UPS ──USB──▶ blue: usbhid-ups → upsd :3493 ◀── upsmon (secondary) on white, red, green
                    │  └─ upsmon (primary) ── NOTIFYCMD ─▶ notify.sh ─▶ notify-telegram ─▶ Telegram
                    └─ report.sh (every minute) ─▶ bridge /api/v1/boards/agent/ups ─▶ Dashboard
```

## Install (on blue, once)

```bash
scp -r infra/ups pi@192.168.50.13:/tmp/ && ssh -t pi@192.168.50.13 'sudo bash /tmp/ups/install.sh'
```

It copies the scripts to `/usr/local/lib/pipe-ups/`, adds the `pipe-ups-report.timer`, and puts a marked block with `NOTIFYCMD` and
`NOTIFYFLAG … SYSLOG+EXEC` into `/etc/nut/upsmon.conf` (replaced on every run; the rest of the file is kept), then restarts `nut-monitor`.
Needs NUT with the section `[cyberpower]` in `/etc/nut/ups.conf`, `/etc/pipe-boardagent.env` and `/usr/local/bin/notify-telegram`.
`--dry-run` shows what it would do, `--remove` takes everything out. `UPS_NAME` / `UPS_HOST` override the section and the host.

## What the NUT setup on the boards is (not in this folder's scripts)

- blue: `MODE=netserver`, `upsd` on 127.0.0.1 and 192.168.50.13:3493, users `upsmon-primary` / `upsmon-secondary` in `/etc/nut/upsd.users` (random
  passwords, mode 640 `root:nut`), `ups.conf` with `offdelay = 120`, `ondelay = 180`: after the boards are down the UPS cuts its outputs 120 s
  later and switches them on 180 s after the mains is back — the PoE boards do not boot by themselves after a shutdown.
- white, red, green: `nut-client`, `MODE=netclient`, `MONITOR cyberpower@192.168.50.13 1 upsmon-secondary … secondary`.
- **Not measured yet:** how long each board needs to stop (white, with Postgres, is the longest). `offdelay` must be longer than that. Measure it
  with a real unplugging (`upsc` shows `OB`, then the boards go down), and only then trust the cut-and-return.
- The USB cable must carry no power (VBUS covered or a data-only cable): with the 5 V line connected the Pi 5 saw an over-current on every USB
  port, five times a second, and the UPS never enumerated.

## Tests

`bash infra/ups/test.sh` (26 checks, Linux: GNU sed) — the body `report.sh` builds, the key kept off the command line, the retry through the
ordinary address, every alert text and its quiet-hours override, and the installer on a stand-in root (idempotent, `--remove`, `--dry-run`). Runs
in the `infra scripts` CI job.
