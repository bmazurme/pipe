# infra/vmbackup — backups of notes and places, kept only on the NAS

The cloud VM (Yandex) runs the Postgres of notes and places and their object storage. Their backups live **only on the NAS**: the VM keeps no
copy of its own, and the Pis do not hold them. The NAS opens the connection, once a day, and the VM answers with an
[`age`](https://age-encryption.org)-encrypted stream. What lands on the NAS is ciphertext; the private key is with the owner
(`~/Documents/pipe-backup-key.txt`, the same one the Pi backups use), so a NAS that is stolen or broken into gives away nothing readable.

```
NAS container (03:20) ──ssh, forced command──▶ VM: serve.sh ──pg_dump | tar | docker save──▶ age ──▶ stdout ──▶ NAS /vm-backups/snapshots/<UTC>/ (14 kept)
```

## What the VM allows

The NAS's key on the VM is `restrict,from="<home address>",command="sudo --preserve-env=SSH_ORIGINAL_COMMAND /usr/local/lib/pipe-vmbackup/serve.sh"`:
no shell, no port forwarding, no pty, only from the home address, and only one program. `serve.sh` takes exactly `<verb>` or `<verb> <word>` and refuses
everything else before running anything:

| command | what you get |
|---|---|
| `ping` | `ok` |
| `db <name>` | `pg_dump -Fc` of that database — only `notes-db` and `places` (`DBS`) |
| `files` | the object storage (minio) as a tar |
| `config` | nginx, letsencrypt, ufw, the firewall script, Swarm service specs, container specs, iptables, cron… as a tar. **Not** `/etc/pipe-*.env` (API keys) |
| `images` | `docker save` of the images the services run, gzipped (weekly; ~GBs) |

A dump is staged only in `/dev/shm` (RAM, mode 700, removed on exit) and checked there — `pg_restore --list` must read it and show table data, the size
must be believable — before anything is printed. A failed check prints nothing on stdout and exits non-zero, so the NAS never takes half a dump for a
backup. The service specs and container inspections contain environment variables (secrets): they travel only inside the encrypted stream.

## Install

The VM side (needs docker; `age` is installed from apt if missing):

```bash
# the PUBLIC key — the same recipient as in the Pi backups: sudo grep AGE /etc/pipe-backup.env on white
scp -r infra/vmbackup USER@VM:/tmp/ && ssh -t USER@VM 'sudo bash /tmp/vmbackup/install.sh --recipient age1…'
```

The NAS side (see `infra/nas/README.md`):

```bash
infra/nas/install.sh build && infra/nas/install.sh keygen-vm     # prints ONE line
ssh -t USER@VM "sudo bash /tmp/vmbackup/install.sh addkey '<that line>'"   # refuses any line that is not restricted and bound to serve.sh
infra/nas/install.sh ping-vm        # proves the key, the forced command and sudo
infra/nas/install.sh once-vm        # one snapshot now
infra/nas/install.sh start          # the daily container (03:20; images on Sundays)
```

`install.sh --remove` takes the command and the sudo rule away (the settings stay); `userdel -r pipebackup` removes the account.

## Proving it restores

The NAS cannot decrypt, so only you can prove a backup is good — do it after the first pull and from time to time:

```bash
AGE_IDENTITY=~/Documents/pipe-backup-key.txt infra/vmbackup/verify-from-workstation.sh
```

It copies the latest snapshot off the NAS, checks `SHA256SUMS`, decrypts, restores each database into a throw-away Postgres and counts its tables.

## Restoring for real

`age -d -i key.txt notes-db.dump.age | docker exec -i <postgres> pg_restore -U postgres -d notes-db --clean --if-exists`, `files.tar.age` → untar into the
minio volume, `config.tar.age` is for reading (service specs, nginx, certificates). The images: `age -d -i key.txt images.tar.gz.age | gunzip | docker load`.

## Tests

`bash infra/vmbackup/test.sh` (Linux; fake docker/age) — what the key may ask for (every other command is refused, nothing runs), each failure printing
nothing, encryption on stdout only, the staging directory removed, the secrets that must not travel left out, and `install.sh` (the sudoers file,
`addkey` accepting only the restricted line, idempotence, `--dry-run`, `--remove`). Runs in the `infra scripts` CI job.
