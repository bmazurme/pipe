#!/bin/sh
# cypress-io/github-action (nightly-reports-e2e.yml) spawns its "start"
# commands directly, not through a shell — and its own command-string
# tokenizer doesn't properly strip quotes from a quoted argument (confirmed
# in CI: `sh -c "cd ../.. && npm run dev --workspace=packages/server"`
# arrived at sh with the surrounding quotes preserved as literal characters,
# so sh tried to run one "command" whose name was the entire multi-word
# string and failed with "not found"). A real script file sidesteps the
# whole problem: one bare path, nothing to mis-tokenize.
#
# Resolves reports/ relative to this script's own location, not the
# caller's cwd, so it works regardless of where it's invoked from — the
# action runs it with cwd=reports/packages/client, two levels below reports/
# (the actual npm workspace root `--workspace=packages/server` needs).
cd "$(dirname "$0")/.." || exit 1
exec npm run dev --workspace=packages/server
