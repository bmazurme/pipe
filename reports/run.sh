#!/usr/bin/env bash
# Double-click-or-run entry point for macOS/Linux, no Docker required. See
# scripts/launch.mjs for what it actually does.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установите Node.js 22+ с https://nodejs.org и запустите этот скрипт снова." >&2
  exit 1
fi

node scripts/launch.mjs
