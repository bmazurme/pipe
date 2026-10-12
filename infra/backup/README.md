# infra/backup — daily database backup

Implements docs/ha-dr-plan.md §6: one backup a day, **verified before it replaces the previous one**.
Today the copies live on the Pi; the NAS comes later (a second `rsync` pulling `latest`).

| File | What |
|---|---|
| `backup.sh` | dump → check (size, readable TOC, has table data, not <50 % of the previous) → optional `age` encryption → checksum → atomic swap of the `latest` symlink. A failed check leaves the last good copy untouched and raises an alert. `--check` exits 1 if the last success is older than 26 h |
| `restore-check.sh` | restores `latest` into a throwaway Postgres container and counts tables/rows — a backup that was never restored is a hope |
| `install.sh` | systemd units: 03:00 Moscow daily + hourly freshness check; template `/etc/pipe-backup.env` (mode 600) |
| `test.sh` | 27 checks with fake `pg_dump`/`pg_restore` (bad dumps never replace `latest`, encryption, `--check`) |

```bash
# on a Mac, in a container (the scripts use flock / mv -T / sha256sum):
docker run --rm -v "$PWD":/r debian:bookworm-slim bash -c 'apt-get update -qq && apt-get install -y -qq age && bash /r/infra/backup/test.sh'
```

## Install on a Pi

```bash
scp -r infra/backup pi@192.168.50.11:/tmp/ && ssh -t pi@192.168.50.11 'sudo bash /tmp/backup/install.sh'
ssh -t pi@192.168.50.11 'sudoedit /etc/pipe-backup.env'          # DATABASE_URL, AGE_RECIPIENT
ssh -t pi@192.168.50.11 'sudo systemctl start pipe-backup.service; sudo journalctl -u pipe-backup.service -n 20 --no-pager'
ssh -t pi@192.168.50.11 'sudo AGE_IDENTITY=... /usr/local/lib/pipe-backup/restore-check.sh'   # proves it restores
ssh -t pi@192.168.50.11 'sudo systemctl enable --now pipe-backup.timer pipe-backup-check.timer'
```

Do it on two Pi (white and red) so the copy survives a dead NVMe. Secrets (`DATABASE_URL`, the `age`
private key) are entered by hand on the board — never in chat or in the repo.

The database must be reachable from the Pi. The primary site's Postgres should accept the Pi only over
the WireGuard tunnel / an allow-listed address (plan §2, §10); the Pi **pulls**, so a compromised primary
cannot reach the backups.

## Encryption

`AGE_RECIPIENT` set → only ciphertext (`db.dump.age`) is stored. Generate the pair once, elsewhere:
`age-keygen -o key.txt` (prints the public key); keep `key.txt` in the password manager and on paper —
without it an encrypted backup cannot be restored. `restore-check.sh` needs `AGE_IDENTITY=<key file>` for
encrypted backups, so run it from a machine that holds the key.

## Restore

```bash
age -d -i key.txt /srv/backups/latest/db.dump.age > db.dump        # skip when not encrypted
pg_restore --no-owner --clean --if-exists -d "$NEW_DATABASE_URL" db.dump
```

## Keeping more than one copy

`KEEP=3` in `/etc/pipe-backup.env` keeps the three newest snapshots (plan §6.1 recommends it; the owner chose
one copy for now).
