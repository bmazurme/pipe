#!/usr/bin/env bash
#
# Secrets for the Pi stack live in ~/.pipe/bridge.env on the primary node (mode 600) — nowhere else, never
# in chat or in git. Run on white:
#
#   ./secrets.sh init           # generates the keys that need no human (DB password, JWT secrets, encryption key)
#   ./secrets.sh set YANDEX_ID  # asks for the value silently and stores it (also YANDEX_SECRET, EMAILS, …)
#   ./secrets.sh check          # which keys are set — names only, never values
#
# Back the file up to the password manager: CREDENTIALS_ENC_KEY encrypts the stored Claude/VPN tokens and the
# secrets vault in the database — a database restored without it cannot decrypt them.
set -euo pipefail

DIR="$HOME/.pipe"
FILE="$DIR/bridge.env"
GENERATED=(POSTGRES_PASSWORD JWT_SECRET REFRESH_JWT_SECRET CREDENTIALS_ENC_KEY)
MANUAL=(YANDEX_ID YANDEX_SECRET EMAILS)
OPTIONAL=(LOOP_GITHUB_TOKEN GITHUB_REPO GITHUB_BASE_BRANCH GITHUB_WEBHOOK_SECRET WORKER_BRIDGE_API_KEY CLAUDE_CODE_OAUTH_TOKEN GITHUB_ID GITHUB_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID APP_HOST API_HOST POSTGRES_USER POSTGRES_DB BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY)

umask 077
mkdir -p "$DIR"
touch "$FILE"
chmod 600 "$FILE"

has() { grep -q "^$1=." "$FILE"; }
put() { # key value — replace the line or append it, without echoing the value
  local tmp; tmp="$(mktemp "$DIR/.env.XXXXXX")"
  grep -v "^$1=" "$FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  mv "$tmp" "$FILE"; chmod 600 "$FILE"
}
generate() {
  case "$1" in
    CREDENTIALS_ENC_KEY) openssl rand -base64 32 ;;
    POSTGRES_PASSWORD) openssl rand -hex 24 ;;
    *) openssl rand -hex 48 ;;
  esac
}

case "${1:-}" in
  init)
    for k in "${GENERATED[@]}"; do
      if has "$k"; then echo "$k: already set"; else put "$k" "$(generate "$k")"; echo "$k: generated"; fi
    done
    echo "next: ./secrets.sh set YANDEX_ID / YANDEX_SECRET / EMAILS"
    ;;
  set)
    key="${2:?usage: secrets.sh set KEY}"
    printf 'value for %s (hidden): ' "$key" >&2
    read -rs value; echo >&2
    [ -n "$value" ] || { echo "empty value, nothing changed" >&2; exit 1; }
    case "$value" in *[[:space:]]*) echo "value contains whitespace — the stack reads this file as KEY=value lines" >&2; exit 1;; esac
    put "$key" "$value"; echo "$key: stored"
    ;;
  check)
    for k in "${GENERATED[@]}" "${MANUAL[@]}"; do has "$k" && echo "set      $k" || echo "MISSING  $k"; done
    for k in "${OPTIONAL[@]}"; do has "$k" && echo "set      $k (optional)" || echo "-        $k (optional)"; done
    ;;
  *) echo "usage: $0 init | set KEY | check" >&2; exit 2 ;;
esac
