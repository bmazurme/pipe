#!/usr/bin/env bash
# Run by pipe-swarm-heal.timer on every board. A Raspberry Pi has no battery clock: after a power cut dockerd can start
# with a wrong date, refuse the Swarm certificates as "not yet valid" and stay out of the cluster (Swarm: error) until
# someone restarts it. If that is the state AND the clock is right now, restart Docker once and say so.
set -u
state="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo unknown)"
[ "$state" = error ] || exit 0
[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ] || { echo "swarm: error, but the clock is not synchronised yet — waiting"; exit 0; }
echo "swarm: error with a synchronised clock — restarting docker"
systemctl restart docker
if [ -x /usr/local/bin/notify-telegram ]; then /usr/local/bin/notify-telegram "🔧 $(hostname): Docker стартовал с неверными часами и не вошёл в Swarm — перезапущен после синхронизации времени" || true; fi
exit 0
