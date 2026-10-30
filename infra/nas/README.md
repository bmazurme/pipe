# infra/nas — the NAS as the fourth copy of the backups

The WD My Cloud EX2 Ultra (2 × 2 TB, RAID 1) keeps a **pulled** copy of the latest verified database backup, so a dead Pi or NVMe does not take
every copy with it. Same rule as the rest of `infra/backup`: the copy host pulls, nothing pushes to it. A container on the NAS runs
`infra/backup/pull.sh` (unchanged) once a day against red; it has no sshd and takes no inbound connection.

```
white (03:00 backup) ──pull 03:30──▶ red ──pull 03:50──▶ NAS container ──▶ /mnt/HD/HD_a2/Nas_Prog/pipe-backup-pull/backups/snapshots/<time>/ (14 kept)
```

The key the NAS holds is restricted on red to `rrsync -ro /srv/backups` from the NAS's address only: read-only, no shell. The files are the
already `age`-encrypted dumps, so the NAS never sees a plaintext database.

## Install (from your workstation; needs the NAS root key, `~/.ssh/nas_ed25519`)

```bash
infra/nas/install.sh build     # copies the build context and builds the image on the NAS (minutes: it is a 1.3 GHz ARM)
infra/nas/install.sh keygen    # makes the pull key in the persistent volume, pins red's host key, prints ONE line
# add that line to pi@192.168.50.12:~/.ssh/authorized_keys, then:
infra/nas/install.sh once      # one pull now - proves the key, rrsync, the checksum and the swap of `latest`
infra/nas/install.sh start     # the daily container (restart: unless-stopped, so it also comes back after a NAS reboot)
infra/nas/install.sh status
```

`SOURCE`, `PULL_AT`, `NAS_HOST`, `NAS_KEY` are environment variables (see the script). Health: the container is `unhealthy` in Portainer / `docker ps`
when the copy is older than 26 hours (`healthcheck.sh`). Nothing alerts on Telegram from the NAS yet — it has no bot token on purpose.

## What this NAS made necessary (checked 2026-10-30, firmware 5.26.119, kernel 4.14 armv7, Docker 20.10.15)

- **The root file system is a RAM disk.** `~/.ssh/authorized_keys` of the NAS's root account (`sshd` in the web UI sense) is lost at every reboot.
  Everything that must survive lives on the data volume (`/mnt/HD/HD_a2/Nas_Prog/pipe-backup-pull/`: the key, the pinned host key, the copies) or in
  `/usr/local/config`. That is why the copy is made by a container with a restart policy and not by something installed on the NAS.
- **The runtime cannot run newer userlands.** Debian bookworm images fail to load glibc, Alpine 3.18+ exits 139 on the first command (so did the
  stock `registry` and `postgres` containers that were crash-looping — they were removed on 2026-10-30; their volumes are kept in
  `Nas_Prog/_docker/volumes`). Alpine 3.16 works, hence the pinned base in the Dockerfile.
- **Switched off for this role** (2026-10-30): the FTP server (`setServiceStartup.sh vsftpd disabled`, saved in the NAS's own config) and
  MySQL's remote access (`mysql_reset.py -d`, which also sets `bind-address=127.0.0.1`; **never** run it with `-r`, that resets the MySQL root
  password and deletes users). SMB, NFS and the web UI stay as they were. WD cloud access was already off. Never expose the NAS to the internet.
- The two data disks are WD Red WD20EFRX with ~36 800 power-on hours (about 4 years 2 months), SMART clean, RAID 1 `[UU]`. Buy the spare disk.

## Tests

`bash infra/nas/test.sh` (16 checks, Linux: GNU date, flock) — the schedule, the key and the printed restricted line, a pull, history kept, a
failing/older source never touching the last good copy, the health check. Runs in the `infra scripts` CI job.
