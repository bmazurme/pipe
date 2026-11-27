#!/bin/sh
# The only thing that runs as root in the container, and only for as long as it takes to give the worker up to its own user.
#
# The worker must start job code as a second user (pipe-runner) that cannot read the worker's key. It does that with `setpriv`, which needs CAP_SETUID and
# CAP_SETGID — and nothing else. So the worker process is started as pipe-worker with exactly those two capabilities as AMBIENT ones (they survive the
# change of user), the bounding set cut down to them, and no-new-privs set. That works with the container hardened as far as
#   --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add SETPCAP --security-opt no-new-privileges --read-only
# (SETPCAP only for cutting the bounding set; without it the cut is skipped and the rest is unchanged), and equally with Docker's default capabilities.
# Job code never gets them: `setpriv` drops every capability before it starts it (worker/src/runAs.ts).
set -eu

# Started as an unprivileged user (--user, or an older way of running the image): nothing to drop here.
if [ "$(id -u)" -ne 0 ]; then
  exec "$@"
fi

# A read-only root has no home for the worker to write to.
export HOME=/tmp

BOUND='--bounding-set=-all,+setuid,+setgid'
setpriv "$BOUND" true 2>/dev/null || BOUND=''

# shellcheck disable=SC2086
exec setpriv --reuid=pipe-worker --regid=pipe-worker --init-groups \
  --inh-caps=+setuid,+setgid --ambient-caps=+setuid,+setgid $BOUND --no-new-privs "$@"
