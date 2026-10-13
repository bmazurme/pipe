#!/usr/bin/env bash
#
# Key-only SSH: switches off password and keyboard-interactive login and root login.
# OPTIONAL. Refuses to run unless the user already has an authorized key, and checks
# the configuration before reloading — but KEEP ONE SSH SESSION OPEN while you test
# a second one, so a mistake cannot lock you out.
#
#   scp infra/pi/harden-ssh.sh pi@192.168.50.89:/tmp/
#   ssh -t pi@192.168.50.89 'sudo bash /tmp/harden-ssh.sh'
#
# (Not `ssh -t ... 'sudo bash -s' < script`: with the script on stdin there is no terminal for
# sudo's password prompt — "a terminal is required to read the password".)
#
set -euo pipefail

USER_NAME="${PI_USER:-pi}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
KEYS="$HOME_DIR/.ssh/authorized_keys"

[ -s "$KEYS" ] || { echo "no keys in $KEYS — refusing: you would lock yourself out" >&2; exit 1; }
echo "authorized keys for $USER_NAME: $(grep -cE '^(ssh-|ecdsa-|sk-)' "$KEYS")"

CONF=/etc/ssh/sshd_config.d/10-key-only.conf
cat > "$CONF" <<'CONF_EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF_EOF

if sshd -t; then
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  echo "sshd reloaded: key-only login is on"
else
  rm -f "$CONF"
  echo "sshd -t failed — change reverted" >&2
  exit 1
fi
