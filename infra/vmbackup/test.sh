#!/usr/bin/env bash
#
# Tests for serve.sh (the NAS key's only command on the VM) and install.sh, with a fake docker / age / iptables / ufw / crontab — nothing outside a
# temporary directory is touched. Linux only (serve.sh uses GNU stat):   bash infra/vmbackup/test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILED=0; BIN="$T/bin"; FIX="$T/fix"; SHM="$T/shm"; mkdir -p "$BIN" "$FIX" "$SHM"
export PATH="$BIN:$PATH" FIX
: > "$T/err"
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok   $1"; else FAILED=$((FAILED + 1)); echo "FAIL $1"; sed 's/^/     | /' "$T/err" | head -8; fi; }
reset() { rm -rf "${FIX:?}"/*; : > "$T/err"; }
mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }

# A fake age: a header line, then stdin rot13'd — a test can tell encrypted from plain, and decode it again.
cat > "$BIN/age" <<'SH'
#!/usr/bin/env bash
[ -f "$FIX/age_fail" ] && exit 1
printf 'age-encryption.org/v1\n'
tr 'A-Za-z' 'N-ZA-Mn-za-m'
SH
unage() { tail -n +2 | tr 'A-Za-z' 'N-ZA-Mn-za-m'; }

cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FIX/docker_calls"
case "$1" in
  exec)
    if [ "$2" = "-i" ]; then      # pg_restore --list, the dump on stdin
      cat > /dev/null
      [ -f "$FIX/restore_fail" ] && { echo "pg_restore: error: not a dump" >&2; exit 1; }
      cat "$FIX/toc"
    elif [ -f "$FIX/dump_fail" ]; then echo "pg_dump: error: connection failed" >&2; exit 1
    else cat "$FIX/dump_bytes"; fi ;;
  service)
    case "$2" in
      ls) if printf '%s' "$*" | grep -q '{{.Name}}'; then printf 'notes_notes-core\nplaces_backend\n'; else printf 'cr.example/notes-core:aaa@sha256:1234\ncr.example/places:bbb\ncr.example/notes-core:aaa\n'; fi ;;
      inspect) printf '{"Spec":{"Name":"%s","Env":"SERVICE-ENV-SECRET"}}\n' "$3" ;;
    esac ;;
  ps) printf 'postgres\nnotes_notes-core.1.abc\n' ;;
  inspect) echo "{\"Name\":\"$2\"}" ;;
  save) [ -f "$FIX/save_fail" ] && exit 1; shift; printf 'IMAGES:%s\n' "$*" ;;
esac
exit 0
SH
for tool in iptables-save ufw crontab; do printf '#!/usr/bin/env bash\necho "fake %s output"\n' "$tool" > "$BIN/$tool"; done
chmod +x "$BIN"/*

CFG="$T/etc"; mkdir -p "$CFG/nginx" "$CFG/letsencrypt" "$T/minio/bucket"
echo "server {}" > "$CFG/nginx/site.conf"; echo "PRIVATE-KEY-PEM" > "$CFG/letsencrypt/privkey.pem"
echo "BRIDGE_API_KEY=brk_must_not_travel" > "$CFG/pipe-cloudagent.env"
echo "an uploaded picture" > "$T/minio/bucket/a.png"
cat > "$T/vmbackup.conf" <<CONF
AGE_RECIPIENT=age1testrecipient
DBS="notes-db places"
MINIO_DIR=$T/minio
CONFIG_PATHS="$CFG/nginx $CFG/letsencrypt $CFG/missing-dir"
EXTRA_IMAGES="postgres:13.2-alpine"
MIN_DB_BYTES=100
STAGE_ROOT=$SHM
CONF

good_dump() {
  reset
  { head -c 4000 /dev/zero | tr '\0' 'D'; printf '\nPLAINTEXT-SENTINEL\n'; } > "$FIX/dump_bytes"
  printf '; Data for Name: notes; Type: TABLE DATA\n' > "$FIX/toc"
}
serve() { SSH_ORIGINAL_COMMAND="$1" VMBACKUP_CONF="$T/vmbackup.conf" bash "$HERE/serve.sh" > "$T/out" 2> "$T/err"; echo $? > "$T/code"; }
code() { cat "$T/code"; }

echo "# what the key may ask for"
for cmd in "" "db" "db evil" "db notes-db; rm -rf /" 'db $(id)' "db notes-db extra" "db ../etc" "rm -rf /" "ping now" "DB notes-db" "bash" "images x" "files x" "config x"; do
  good_dump; serve "$cmd"
  [ "$(code)" = 2 ] && [ ! -s "$T/out" ] && [ ! -e "$FIX/docker_calls" ]; check "refuses '${cmd}' - exit 2, no output, nothing run" $?
done
good_dump; serve ping; [ "$(code)" = 0 ] && [ "$(cat "$T/out")" = ok ]; check "ping answers ok" $?

echo "# a database"
good_dump; serve "db notes-db"
[ "$(code)" = 0 ] && head -1 "$T/out" | grep -qx 'age-encryption.org/v1'; check "db: exits 0 and prints an age stream" $?
unage < "$T/out" | grep -q PLAINTEXT-SENTINEL; check "db: the stream decrypts to the dump" $?
! grep -q PLAINTEXT-SENTINEL "$T/out"; check "db: the plaintext is never on stdout" $?
grep -q "exec postgres pg_dump -U postgres -Fc notes-db" "$FIX/docker_calls"; check "db: pg_dump -Fc of exactly that database" $?
[ -z "$(ls -A "$SHM")" ]; check "db: the staging directory in RAM is removed afterwards" $?
good_dump; serve "db places"; [ "$(code)" = 0 ]; check "db: the other listed database works" $?
good_dump; serve "db tools"
[ "$(code)" = 2 ] && [ ! -s "$T/out" ] && [ ! -e "$FIX/docker_calls" ]; check "db: a database that is not on the list is refused before pg_dump" $?
good_dump; : > "$FIX/dump_fail"; serve "db notes-db"
[ "$(code)" = 1 ] && [ ! -s "$T/out" ] && grep -q 'pg_dump of notes-db failed' "$T/err"; check "db: a failing pg_dump prints nothing and fails" $?
good_dump; head -c 20 /dev/zero > "$FIX/dump_bytes"; serve "db notes-db"
[ "$(code)" = 1 ] && [ ! -s "$T/out" ] && grep -q 'only 20 bytes' "$T/err"; check "db: a dump that is too small is not handed over as a backup" $?
good_dump; : > "$FIX/restore_fail"; serve "db notes-db"
[ "$(code)" = 1 ] && [ ! -s "$T/out" ] && grep -q 'not readable' "$T/err"; check "db: a dump pg_restore cannot read is not handed over" $?
good_dump; printf '; just a header\n' > "$FIX/toc"; serve "db notes-db"
[ "$(code)" = 1 ] && [ ! -s "$T/out" ] && grep -q 'no table data' "$T/err"; check "db: a dump with no table data is not handed over" $?
good_dump; : > "$FIX/age_fail"; serve "db notes-db"
[ "$(code)" = 1 ] && grep -q 'encryption failed' "$T/err"; check "db: a failing encryption fails the command" $?
[ -z "$(ls -A "$SHM")" ]; check "every failure also removed the staging directory" $?

echo "# files, config, images"
good_dump; serve files
[ "$(code)" = 0 ] && unage < "$T/out" | tar -tf - | grep -q 'bucket/a.png'; check "files: the object storage as a readable tar, encrypted" $?
mv "$T/minio" "$T/minio.gone"; good_dump; serve files
[ "$(code)" = 1 ] && [ ! -s "$T/out" ]; check "files: a missing storage directory fails with no output" $?
mv "$T/minio.gone" "$T/minio"
good_dump; serve config
unage < "$T/out" | tar -tf - > "$T/list" 2>/dev/null
[ "$(code)" = 0 ] && grep -q 'cfg/docker-services.json' "$T/list" && grep -q 'nginx/site.conf' "$T/list" && grep -q 'letsencrypt/privkey.pem' "$T/list"; check "config: Swarm specs, nginx and the certificates' keys are in it" $?
! grep -q 'pipe-cloudagent.env' "$T/list"; check "config: the agents' API keys are left out" $?
! grep -q 'missing-dir' "$T/list"; check "config: a path that does not exist is skipped, not an error" $?
! grep -q SERVICE-ENV-SECRET "$T/out"; check "config: what the service specs hold (their env) is only ever inside the encrypted stream" $?
CFGDEFAULT="$(grep '^CONFIG_PATHS=' "$HERE/serve.sh")"
case "$CFGDEFAULT" in *.env*) false ;; *) true ;; esac; check "config: the default path list names no *.env file" $?
good_dump; serve images
[ "$(code)" = 0 ] && head -1 "$T/out" | grep -qx 'age-encryption.org/v1'; check "images: an encrypted stream" $?
unage < "$T/out" | gzip -dc > "$T/images.txt" 2>/dev/null
grep -q 'IMAGES:' "$T/images.txt"; check "images: gzip inside the encryption" $?
[ "$(tr ' ' '\n' < "$T/images.txt" | grep -c 'cr.example/notes-core:aaa')" = 1 ]; check "images: each image once, @sha256 stripped" $?
grep -q 'postgres:13.2-alpine' "$T/images.txt"; check "images: the extra images named in the settings are included" $?
good_dump; : > "$FIX/save_fail"; serve images
[ "$(code)" = 1 ] && grep -q 'saving the images failed' "$T/err"; check "images: a failing docker save fails the command" $?

echo "# install.sh"
R="$T/root"; mkdir -p "$R"
ROOT="$R" bash "$HERE/install.sh" > "$T/out" 2> "$T/err"; [ $? -ne 0 ] && grep -q 'needs --recipient' "$T/err"; check "install: a first install without a recipient is refused" $?
ROOT="$R" bash "$HERE/install.sh" --recipient notakey > "$T/out" 2> "$T/err"; [ $? -ne 0 ] && grep -q 'not an age public key' "$T/err"; check "install: something that is not an age public key is refused" $?
ROOT="$R" bash "$HERE/install.sh" --recipient age1abcdef > "$T/out" 2> "$T/err"; rc=$?
[ "$rc" = 0 ] && [ -x "$R/usr/local/lib/pipe-vmbackup/serve.sh" ]; check "install: serve.sh is in place" $?
grep -q '^AGE_RECIPIENT=age1abcdef$' "$R/etc/pipe-vmbackup.conf"; check "install: the settings carry the recipient (the public key)" $?
[ "$(cat "$R/etc/sudoers.d/pipe-vmbackup")" = "pipebackup ALL=(root) NOPASSWD:SETENV: /usr/local/lib/pipe-vmbackup/serve.sh" ]; check "install: sudo may run exactly that script, nothing else" $?
[ "$(mode "$R/etc/sudoers.d/pipe-vmbackup")" = 440 ]; check "install: the sudoers file is mode 440" $?
echo 'AGE_RECIPIENT=age1mine' > "$R/etc/pipe-vmbackup.conf"; ROOT="$R" bash "$HERE/install.sh" > "$T/out" 2>&1
grep -q 'age1mine' "$R/etc/pipe-vmbackup.conf"; check "install: an existing settings file is not overwritten" $?

GOOD='restrict,from="89.207.218.46",command="sudo --preserve-env=SSH_ORIGINAL_COMMAND /usr/local/lib/pipe-vmbackup/serve.sh" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest pipe-nas-vm'
AK="$R/home/pipebackup/.ssh/authorized_keys"
for bad in 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest pipe-nas-vm' 'command="/bin/sh" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest x' 'restrict,command="sudo --preserve-env=SSH_ORIGINAL_COMMAND /bin/bash" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest x' 'restrict,from="1.2.3.4" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest x'; do
  ROOT="$R" bash "$HERE/install.sh" addkey "$bad" > "$T/out" 2> "$T/err"; rc=$?
  [ "$rc" -ne 0 ] && [ ! -s "$AK" ]; check "addkey: refuses a line not restricted and bound to serve.sh (${bad:0:36}...)" $?
done
ROOT="$R" bash "$HERE/install.sh" addkey "$GOOD" > "$T/out" 2> "$T/err"
[ "$(cat "$AK")" = "$GOOD" ]; check "addkey: the restricted line is added as it is" $?
ROOT="$R" bash "$HERE/install.sh" addkey "$GOOD" > "$T/out" 2>&1
[ "$(wc -l < "$AK")" -eq 1 ]; check "addkey: adding it again does not duplicate it" $?
[ "$(mode "$AK")" = 600 ]; check "addkey: authorized_keys is mode 600" $?
R2="$T/root2"; mkdir -p "$R2"; ROOT="$R2" bash "$HERE/install.sh" --recipient age1abc --dry-run > "$T/out" 2>&1
[ ! -e "$R2/usr" ] && grep -q would "$T/out"; check "install --dry-run: changes nothing" $?
ROOT="$R" bash "$HERE/install.sh" --remove > "$T/out" 2>&1
[ ! -e "$R/usr/local/lib/pipe-vmbackup" ] && [ ! -e "$R/etc/sudoers.d/pipe-vmbackup" ] && [ -f "$R/etc/pipe-vmbackup.conf" ]; check "install --remove: takes the command and the sudo rule away, leaves the settings" $?

echo; echo "$PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
