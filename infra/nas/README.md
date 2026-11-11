# infra/nas — the NAS as the fourth copy of the backups

The WD My Cloud EX2 Ultra (2 × 2 TB, RAID 1) keeps a **pulled** copy of the latest verified database backup, so a dead Pi or NVMe does not take
every copy with it. Same rule as the rest of `infra/backup`: the copy host pulls, nothing pushes to it. A container on the NAS runs
`infra/backup/pull.sh` (unchanged) once a day against red; it has no sshd and takes no inbound connection.

```
white (03:00 backup) ──pull 03:30──▶ red ──pull 03:50──▶ NAS container ──▶ /mnt/HD/HD_a2/Nas_Prog/pipe-backup-pull/backups/snapshots/<time>/ (14 kept)
```

The key the NAS holds is restricted on red to `rrsync -ro /srv/backups` from the NAS's address only: read-only, no shell. The files are the
already `age`-encrypted dumps, so the NAS never sees a plaintext database.

## The cloud VM's backups (notes and places) — only here

The same container also pulls the **encrypted** backups of notes and places from the cloud VM (`vm-pull.sh`, 03:20, the VM's side is
`infra/vmbackup`): both databases, the object storage and the configuration every day, the Docker images on Sundays. They are kept nowhere else — not
on the VM, not on the Pis. `snapshots/<UTC>/` under `Nas_Prog/pipe-backup-pull/vm-backups/` (14 kept; images 4), each with `SHA256SUMS` and `meta.env`;
a snapshot is all-or-nothing, and `last-success` moves only when a whole one landed. The NAS holds only ciphertext (no key that reads it), so it cannot
check a dump itself — the VM checks before it sends, and `infra/vmbackup/verify-from-workstation.sh` proves a restore from your machine.
The container is `unhealthy` when either pull is older than 26 hours.

```bash
infra/nas/install.sh build && infra/nas/install.sh keygen-vm   # a second key, only for the VM; prints the line for `infra/vmbackup/install.sh addkey`
infra/nas/install.sh ping-vm && infra/nas/install.sh once-vm   # after the line is on the VM
infra/nas/install.sh start                                     # recreate the container with VM_SOURCE (default pipebackup@89.169.132.49)
```

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
  After a NAS reboot `Permission denied (publickey,password)` is therefore expected: `infra/nas/install.sh restore-ssh` puts the key back (it asks for the
  NAS password once). The daily pulls do not need it — the container restarts by itself and opens its own connections — only deploying from the workstation
  does. Making the key survive would mean editing the firmware's boot scripts (`/etc/rc.sh`, `system_init`; the only persistent file system is the 12 MB
  `/usr/local/config`), which is not worth the risk on the machine that holds the backups.
- **The runtime cannot run newer userlands.** Debian bookworm images fail to load glibc, Alpine 3.18+ exits 139 on the first command (so did the
  stock `registry` and `postgres` containers that were crash-looping — they were removed on 2026-10-30; their volumes are kept in
  `Nas_Prog/_docker/volumes`). Alpine 3.16 works, hence the pinned base in the Dockerfile.
- **Switched off for this role** (2026-10-30): the FTP server (`setServiceStartup.sh vsftpd disabled`, saved in the NAS's own config) and
  MySQL's remote access (`mysql_reset.py -d`, which also sets `bind-address=127.0.0.1`; **never** run it with `-r`, that resets the MySQL root
  password and deletes users). SMB, NFS and the web UI stay as they were. WD cloud access was already off. Never expose the NAS to the internet.
- The two data disks are WD Red WD20EFRX with ~36 800 power-on hours (about 4 years 2 months), SMART clean, RAID 1 `[UU]`. Buy the spare disk.

## Tests

`bash infra/nas/test.sh` (Linux: GNU date, flock) — the schedule, the key and the printed restricted line, a pull, history kept, a
failing/older source never touching the last good copy, the health check, and the VM pull (an all-or-nothing snapshot, a plain-text or tiny stream
refused, retention, the VM key's line accepted by the VM's `addkey`). Runs in the `infra scripts` CI job.

## The Dashboard tile

With a boards-only API key the container also reports how the NAS is doing every 10 minutes (`report.sh`): the age of the copy it keeps, the RAID state
(the host's `/proc/mdstat`, mounted read-only), the data volume's free space, each disk's SMART (health, reallocated / pending / uncorrectable sectors, power-on
hours, temperature — the container gets `--device /dev/sda --device /dev/sdb --cap-add SYS_RAWIO` for that) and the uptime. It goes to the stack's VIP
(`--resolve api.bridge.ntlstl.dev:443:192.168.50.10`), so it does not need the internet or the router's port forwarding. Bridge shows it on the Дашборд page.

```bash
PI_KEY_SOURCE=pi@192.168.50.11 infra/nas/install.sh setkey   # copies the key from the board agent's settings to the NAS, never printing it
infra/nas/install.sh build && infra/nas/install.sh start     # rebuild with the new files, recreate the container
```
