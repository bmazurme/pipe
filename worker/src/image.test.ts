import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// The image's isolation is configuration, not code: these pin the parts a later edit could quietly undo (S1). The proof that it works is a container run,
// described in worker/README.md; this keeps the pieces from drifting apart.
const here = path.dirname(fileURLToPath(import.meta.url));
const dockerfile = readFileSync(path.join(here, '..', 'Dockerfile'), 'utf8');
const entrypoint = readFileSync(path.join(here, '..', 'docker-entrypoint.sh'), 'utf8');
const code = (text: string) => text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');

describe('worker/Dockerfile', () => {
  it('pins the ids of the two users and the group, because a volume made by an older image keeps its files owned by those numbers', () => {
    const body = code(dockerfile);

    assert.match(body, /addgroup -S -g 101 pipe-worker && adduser -S -u 100 -G pipe-worker pipe-worker/);
    assert.match(body, /addgroup -S -g 102 pipe-jobs && adduser -S -u 101 -h \/home\/pipe-runner -G pipe-jobs pipe-runner/);
  });

  it('switches users with setpriv, not sudo: a setuid binary cannot work under no-new-privileges', () => {
    const body = code(dockerfile);

    assert.match(body, /apk add --no-cache setpriv/);
    assert.doesNotMatch(body, /\bsudo\b/);
    assert.match(body, /ENV WORKER_RUN_AS_VIA=setpriv/);
    assert.match(body, /ENV WORKER_RUN_AS=pipe-runner/);
  });

  it('starts through the entrypoint, which is the only thing that runs as root', () => {
    const body = code(dockerfile);

    assert.match(body, /COPY worker\/docker-entrypoint\.sh \/usr\/local\/bin\/pipe-entrypoint/);
    assert.match(body, /ENTRYPOINT \["\/usr\/local\/bin\/pipe-entrypoint"\]/);
    assert.match(body, /CMD \["node", "dist\/index\.js"\]/);
    // the state directory stays closed to the runner
    assert.match(body, /chmod 0700 \/app\/\.worker-state/);
  });
});

describe('worker/docker-entrypoint.sh', () => {
  const body = code(entrypoint);

  it('gives the worker up to its own user with only CAP_SETUID and CAP_SETGID, as ambient capabilities, and no-new-privs', () => {
    assert.match(body, /--reuid=pipe-worker --regid=pipe-worker --init-groups/);
    assert.match(body, /--inh-caps=\+setuid,\+setgid --ambient-caps=\+setuid,\+setgid/);
    assert.match(body, /--no-new-privs/);
    assert.match(body, /--bounding-set=-all,\+setuid,\+setgid/);
  });

  it('asks for no capability beyond those two', () => {
    const caps = [...body.matchAll(/\+([a-z_]+)/g)].map((match) => match[1]);

    assert.deepEqual([...new Set(caps)].sort(), ['setgid', 'setuid']);
  });

  it('carries on without the bounding-set cut when the container has no CAP_SETPCAP, instead of failing to start', () => {
    assert.match(body, /setpriv "\$BOUND" true 2>\/dev\/null \|\| BOUND=''/);
  });

  it('does nothing when it is not root, and gives the worker a home it can write on a read-only root', () => {
    assert.match(body, /if \[ "\$\(id -u\)" -ne 0 \]; then\s+exec "\$@"/);
    assert.match(body, /export HOME=\/tmp/);
  });
});
