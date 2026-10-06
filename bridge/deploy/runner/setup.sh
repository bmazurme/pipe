#!/usr/bin/env bash
#
# One-time setup of a self-hosted GitHub Actions runner for this repo, so CI
# and deploy don't spend GitHub-hosted (paid) minutes.
#
# Run it on a Linux host that has Docker (CI's Postgres service containers and
# the image builds need it — service containers don't work on macOS/Windows
# runners). It can be the swarm VM itself or any other box:
#
#   REPO=bmazurme/pipe RUNNER_TOKEN=<token> bash setup.sh
#
# RUNNER_TOKEN is the short-lived registration token from
#   Settings → Actions → Runners → New self-hosted runner
# (or: gh api -X POST repos/<repo>/actions/runners/registration-token --jq .token).
# It expires in about an hour and is never stored by this script.
#
# Afterwards set the repo VARIABLE (not secret) RUNNER_LABEL to the label below:
#   gh variable set RUNNER_LABEL --body pipe-runner
# The workflows fall back to ubuntu-latest while it is unset.
#
# Idempotent: re-running on a host that is already configured only restarts
# the service.
set -euo pipefail

REPO=${REPO:?set REPO, e.g. bmazurme/pipe}
LABEL=${RUNNER_LABEL:-pipe-runner}
RUNNER_VERSION=${RUNNER_VERSION:-2.329.0}
RUNNER_DIR=${RUNNER_DIR:-$HOME/actions-runner}

info() { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
fail() {
  printf '\033[0;31m[x]\033[0m %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = Linux ] || fail 'a Linux host is required'
command -v docker >/dev/null || fail 'docker not found on this host'
docker info >/dev/null 2>&1 || fail 'the current user cannot talk to docker (add it to the docker group)'
[ "$(id -u)" -ne 0 ] || fail 'do not run the runner as root'

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH=x64 ;;
  aarch64) ARCH=arm64 ;;
  *) fail "unsupported architecture: $ARCH" ;;
esac

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -f .runner ]; then
  : "${RUNNER_TOKEN:?set RUNNER_TOKEN (registration token)}"
  if [ ! -x ./config.sh ]; then
    info "Downloading runner ${RUNNER_VERSION} (${ARCH})"
    curl -fsSL -o runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${ARCH}-${RUNNER_VERSION}.tar.gz"
    tar xzf runner.tar.gz
    rm runner.tar.gz
  fi
  info "Registering with ${REPO} as label '${LABEL}'"
  ./config.sh --unattended --url "https://github.com/${REPO}" --token "$RUNNER_TOKEN" \
    --labels "$LABEL" --name "$(hostname)-${LABEL}" --replace
else
  info 'Runner already configured'
fi

info 'Installing and starting the systemd service'
sudo ./svc.sh install "$USER" 2>/dev/null || true
sudo ./svc.sh start
sudo ./svc.sh status | head -5

info "Done. Now: gh variable set RUNNER_LABEL --body ${LABEL}"
