#!/usr/bin/env bash
#
# S3 — protects `main`: a change gets in only after the CI checks passed. Without this, `main` takes any push and any merge, and every merge is a
# deploy (publish-images → the boards' autodeploy).
#
#   infra/github/protect-main.sh            SHOWS what it would set and what is set now — changes nothing
#   infra/github/protect-main.sh apply      sets it (needs a token that may administer the repository: `gh auth status`)
#   infra/github/protect-main.sh remove     takes the protection off again
#
# What it sets: the eight CI jobs of .github/workflows/ci.yml are REQUIRED status checks (not «up to date with main»: strict is off, or every merge
# would need a rebase); NOT enforced for administrators — the owner can still push or merge past a failed check on purpose (`gh pr merge --admin`),
# nobody else, and the assistant (it uses the owner's token as a PR author, not as an admin merge) cannot; force pushes and deleting `main` are refused.
# No required review: the owner is the author of the assistant's pull requests and cannot approve their own (see .github/CODEOWNERS).
#
# Know before applying: a pull request whose head commit a workflow pushed with GITHUB_TOKEN (the `regen` job's regenerated OpenAPI files) gets no CI
# run from that push — its required checks stay «expected» until you run the workflow by hand (Actions → CI → Run workflow on that branch; the checks
# of that run count). The CodeQL checks are not required (a scan that is slow or down must not block a merge).
set -euo pipefail

REPO="${REPO:-bmazurme/pipe}"
BRANCH="${BRANCH:-main}"
# The `name:` of each job in .github/workflows/ci.yml — a check that is required under a name that no job has any more blocks every merge, so
# the script checks them against ci.yml before it applies (and infra/github/test.sh checks it in CI).
CHECKS=(
  "protocol (build, tests)"
  "harness (build, tests)"
  "sync (build, tests)"
  "worker (build, tests)"
  "reports (build, tests)"
  "bridge backend (lint, build, tests)"
  "bridge frontend (lint, build, tests)"
  "infra scripts (shell tests)"
)
HERE="$(cd "$(dirname "$0")" && pwd)"
CI_FILE="${CI_FILE:-$HERE/../../.github/workflows/ci.yml}"

job_names() { sed -n 's/^    name: //p' "$CI_FILE"; }

# Every required check must be a job name of ci.yml; prints the ones that are not.
unknown_checks() {
  local check names
  names="$(job_names)"
  for check in "${CHECKS[@]}"; do
    grep -qxF -- "$check" <<<"$names" || echo "$check"
  done
}

payload() {
  python3 - "${CHECKS[@]}" <<'PY'
import json, sys
print(json.dumps({
    "required_status_checks": {"strict": False, "contexts": sys.argv[1:]},
    "enforce_admins": False,
    "required_pull_request_reviews": None,
    "restrictions": None,
    "allow_force_pushes": False,
    "allow_deletions": False,
}))
PY
}

case "${1:-show}" in
  show)
    echo "would require, on $REPO:$BRANCH:"
    printf '  - %s\n' "${CHECKS[@]}"
    echo "not enforced for administrators; no required review; no force pushes; the branch cannot be deleted"
    bad="$(unknown_checks)"
    if [ -n "$bad" ]; then echo "PROBLEM: not a job name in ci.yml (applying would block every merge):"; echo "$bad" | sed 's/^/  - /'; exit 1; fi
    echo "all of them are job names of ci.yml"
    echo "--- now:"
    gh api "repos/$REPO/branches/$BRANCH/protection" --jq '{checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled}' 2>&1 | head -3
    ;;
  apply)
    bad="$(unknown_checks)"
    [ -z "$bad" ] || { echo "refusing: not a job name in ci.yml:"; echo "$bad" | sed 's/^/  - /'; exit 1; }
    payload | gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - --jq '{checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled}'
    ;;
  remove)
    gh api -X DELETE "repos/$REPO/branches/$BRANCH/protection" && echo "protection removed"
    ;;
  *) echo "usage: $0 [show|apply|remove]" >&2; exit 2 ;;
esac
