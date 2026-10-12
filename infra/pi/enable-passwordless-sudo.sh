#!/usr/bin/env bash
#
# Passwordless sudo for the `pi` user, and sudo-free access to Docker and the
# Pi's hardware sensors. Idempotent; validates the sudoers file before installing
# it, so a typo cannot lock sudo.
#
# Run it from your computer (sudo prompts for the password ONCE, on the Pi):
#
#   scp infra/pi/enable-passwordless-sudo.sh pi@192.168.50.89:/tmp/
#   ssh -t pi@192.168.50.89 'sudo bash /tmp/enable-passwordless-sudo.sh'
#
# (Not `ssh -t ... 'sudo bash -s' < script`: with the script on stdin there is no terminal for
# sudo's password prompt — "a terminal is required to read the password".)
#
set -euo pipefail

USER_NAME="${PI_USER:-pi}"
FILE="/etc/sudoers.d/90-${USER_NAME}-nopasswd"

id "$USER_NAME" >/dev/null 2>&1 || { echo "no such user: $USER_NAME" >&2; exit 1; }

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
echo "${USER_NAME} ALL=(ALL) NOPASSWD:ALL" > "$TMP"

# Validate the new file on its own, install it with the mode sudo requires (0440),
# then validate the whole configuration.
visudo -cf "$TMP" >/dev/null
install -m 0440 -o root -g root "$TMP" "$FILE"
visudo -c >/dev/null
echo "sudoers: $FILE installed"

# Without sudo: `docker ...` (group docker) and `vcgencmd` temperatures/throttling (group video).
for group in docker video; do
  if getent group "$group" >/dev/null; then
    usermod -aG "$group" "$USER_NAME"
    echo "group: $USER_NAME is in $group"
  fi
done

echo "done — log in again (or run: newgrp docker) for the new groups to apply"
