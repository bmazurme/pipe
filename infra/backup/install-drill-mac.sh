#!/usr/bin/env bash
#
# Installs the monthly restore drill (R7) on your Mac — where the backup's private age key lives — as a launchd agent (run as yourself):
#
#   bash infra/backup/install-drill-mac.sh [install|uninstall|status]
#
# launchd runs it every Monday 10:00 (and at the next wake-up if the Mac was asleep); the script does the drill only when the last good one is
# 30+ days old, and skips quietly when Docker Desktop is not running or the home network is out of reach (nothing is reported then — the
# 35-day alert on the Dashboard / in Telegram is what notices a drill that never gets to run).
#
# Settings: ~/.config/pipe/restore-drill.env (mode 600, never overwritten):
#   SOURCE_HOST (default 192.168.50.12), AGE_IDENTITY (your private key file), BRIDGE_URL, BRIDGE_API_KEY (a key with scope «boards»).
# Needs: docker (Docker Desktop), age (brew install age), ssh access to the board (pi@HOST, passwordless sudo tar — the same as verify-from-workstation.sh).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
LABEL=lt.pipe.restore-drill
DIR="$HOME/.local/share/pipe-restore-drill"
CONF_DIR="$HOME/.config/pipe"
CONF="$CONF_DIR/restore-drill.env"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/.local/state/pipe-restore-drill/drill.log"

case "${1:-install}" in
  install)
    command -v docker >/dev/null || { echo "docker is required (Docker Desktop)" >&2; exit 1; }
    command -v age >/dev/null || { echo "age is required: brew install age" >&2; exit 1; }
    mkdir -p "$DIR" "$CONF_DIR" "$(dirname "$LOG")" "$(dirname "$PLIST")"
    install -m 755 "$SRC/restore-drill.sh" "$DIR/restore-drill.sh"
    if [ ! -f "$CONF" ]; then
      install -m 600 /dev/null "$CONF"
      cat > "$CONF" <<'CONF'
# Settings for the restore drill on this Mac. Plain KEY=value lines.
SOURCE_HOST=192.168.50.12
# Your private age key file (the backups are encrypted to its public half):
AGE_IDENTITY=
# Where to report: bridge, and a personal API key with scope «boards» (Profile → API keys):
BRIDGE_URL=
BRIDGE_API_KEY=
CONF
      echo "created $CONF — fill in AGE_IDENTITY, BRIDGE_URL, BRIDGE_API_KEY"
    fi
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>$DIR/restore-drill.sh</string><string>--if-due</string><string>30</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Docker.app/Contents/Resources/bin</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed: $PLIST (Mondays 10:00). Try it now:  bash $DIR/restore-drill.sh   (log: $LOG)"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed the agent (settings in $CONF and the script in $DIR are kept)"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | sed -n '1,12p' || echo "not installed"
    [ -f "$HOME/.local/state/pipe-restore-drill/last-ok" ] && echo "last good drill: $(date -r "$(cat "$HOME/.local/state/pipe-restore-drill/last-ok")")" || echo "no good drill yet"
    ;;
  *) echo "usage: $0 [install|uninstall|status]" >&2; exit 64;;
esac
