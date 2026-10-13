# infra/backup — daily database backup

Implements docs/ha-dr-plan.md §6: one backup a day, **verified before it replaces the previous one**.
Today the copies live on the Pi; the NAS comes later (a second `rsync` pulling `latest`).

| File | What |
|---|---|
| `backup.sh` | dump → check (size, readable TOC, has table data, not <50 % of the previous) → optional `age` encryption → checksum → atomic swap of the `latest` symlink. A failed check leaves the last good copy untouched and raises an alert. `--check` exits 1 if the last success is older than 26 h |
| `restore-check.sh` | restores `latest` into a throwaway Postgres container and counts tables/rows — a backup that was never restored is a hope |
| `install.sh` | systemd units: 03:00 Moscow daily + hourly freshness check; template `/etc/pipe-backup.env` (mode 600) |
| `pull.sh`, `install-pull.sh` | the copy on a **second Pi**: it pulls `latest` from the primary (rsync over a key restricted to read-only `rrsync` — no shell, no writes), verifies checksum/meta/age, then swaps its own `latest`. Daily 03:30 Moscow + hourly freshness check (age counted from the backup's creation, so a primary that stopped backing up is noticed too) |
| `mirror-s3.sh`, `install-mirror.sh` | the **third copy**: the second Pi uploads the (encrypted, verified) `latest` to the Garage bucket `bridge-backups` — to an immutable `snapshots/<time>/` prefix, compares it with the local files, and only then rewrites the pointer object `LATEST`. Daily 03:45 Moscow, after the pull |
| `uploads-pull.sh`, `install-uploads.sh` | the **uploaded files** (`bridge_uploads`: parcels in transit, chat attachments) — the database dump does not hold them. red pulls the volume over a restricted read-only `rrsync` key into `/srv/uploads-mirror/current`, keeps what the primary deletes in `deleted/<date>/` (14 days), refuses a run that would delete more than half of the files, then mirrors to the Garage bucket `bridge-uploads`. Daily 04:10 Moscow + hourly freshness check |
| `verify-from-workstation.sh` | run on YOUR machine: fetches `latest` from a Pi, decrypts it with your private age key and restores it into a throwaway Postgres — the check that stays possible once the boards no longer hold the key |
| `test.sh` | 71 checks with fake `pg_dump`/`pg_restore` (bad dumps never replace `latest`, encryption, `--check`, pull: tampered / older / unreachable source) |

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

## A copy on a second Pi (pull)

```bash
scp -r infra/backup pi@192.168.50.12:/tmp/ && ssh -t pi@192.168.50.12 'sudo bash /tmp/backup/install-pull.sh'
# it prints one line — add it to pi@192.168.50.11:~/.ssh/authorized_keys (it is restricted to read-only /srv/backups)
ssh -t pi@192.168.50.12 'sudo systemctl start pipe-backup-pull.service && sudo systemctl enable --now pipe-backup-pull.timer pipe-backup-pull-check.timer'
```

The pull key can neither open a shell on the primary nor write there (checked). Running state (2026-10-12): primary white
(03:00) → red pulls at 03:30. Then red uploads to the Garage bucket `bridge-backups` (03:45). Next copy: the NAS.

## A copy in Garage S3 (mirror)

```bash
# the bridge-backups key goes from white to red without being printed; the endpoint is red's own Garage node
ssh pi@192.168.50.11 'sudo cat /etc/garage/keys/bridge-backups.env' | ssh pi@192.168.50.12 'sudo tee /etc/pipe-backup-s3.env >/dev/null'
ssh pi@192.168.50.12 'sudo sed -i "s|^S3_ENDPOINT=.*|S3_ENDPOINT=http://192.168.50.12:3900|" /etc/pipe-backup-s3.env'
scp -r infra/backup pi@192.168.50.12:/tmp/ && ssh -t pi@192.168.50.12 'sudo bash /tmp/backup/install-mirror.sh'
ssh -t pi@192.168.50.12 'sudo systemctl start pipe-backup-mirror.service && sudo systemctl enable --now pipe-backup-mirror.timer'
```

Reading it back (any Garage node works): `rclone cat pi:bridge-backups/LATEST` names the snapshot, `rclone copy
pi:bridge-backups/snapshots/<name> .` fetches it. Verified on 2026-10-12: uploaded via red, downloaded via green, checksums equal.

## The uploaded files

```bash
scp -r infra/backup pi@192.168.50.12:/tmp/ && ssh -t pi@192.168.50.12 'sudo bash /tmp/backup/install-uploads.sh'
# add the printed line to pi@192.168.50.11:~/.ssh/authorized_keys (a separate key: read-only access to the uploads volume, nothing else)
ssh pi@192.168.50.11 'sudo cat /etc/garage/keys/bridge-uploads.env' | ssh pi@192.168.50.12 'sed "s|^S3_ENDPOINT=.*|S3_ENDPOINT=http://192.168.50.12:3900|" | sudo tee -a /etc/pipe-uploads.env >/dev/null'
ssh -t pi@192.168.50.12 'sudo systemctl start pipe-uploads-pull.service && sudo systemctl enable --now pipe-uploads-pull.timer pipe-uploads-check.timer'
```

Not encrypted (unlike the dumps): these are the user's own files on boards in your LAN; the Garage copy is on the same boards. The failover
(`infra/failover`) restores them from `bridge-uploads` / `/srv/uploads-mirror` into the new primary's volume.

## Encryption

`AGE_RECIPIENT` set → only ciphertext (`db.dump.age`) is stored. Generate the pair once, elsewhere:
`age-keygen -o key.txt` (prints the public key); keep `key.txt` in the password manager and on paper —
without it an encrypted backup cannot be restored. On the boards `restore-check.sh` can only verify unencrypted backups; for encrypted ones run
`AGE_IDENTITY=<key file> infra/backup/verify-from-workstation.sh [host]` from the machine that holds the key.

## Restore

```bash
age -d -i key.txt /srv/backups/latest/db.dump.age > db.dump        # skip when not encrypted
pg_restore --no-owner --clean --if-exists -d "$NEW_DATABASE_URL" db.dump
```

## Keeping more than one copy

`KEEP=3` in `/etc/pipe-backup.env` keeps the three newest snapshots (plan §6.1 recommends it; the owner chose
one copy for now).
