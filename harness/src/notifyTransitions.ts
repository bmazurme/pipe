import { notify } from '@pipe/protocol/notify';

import type { TaskEvent } from './events.js';

// Turns events.ts's internal signature tokens (taskSignature()'s own
// vocabulary — stable identifiers, not meant for display) into something
// readable in an OS notification. Mirrors taskSignature()'s own branches
// one-for-one rather than re-deriving a label from deriveStatus() — that
// label bakes in staleness wording that changes with the passage of time
// alone (see events.ts's own comment on why the signature isn't the
// label), which would make an identical signature render two different
// ways depending on when notifyTransitions happens to run.
const SIGNATURE_LABELS: Record<string, string> = {
  'no-local-state': 'no local state',
  'gitlab-worker': 'pushed to bridge, waiting on agent-runner',
  'gitlab-worker+agent-runner': 'agent-runner result pushed, likely ready to pull',
  'agent-runner': 'agent-runner result pushed (no gitlab-worker record)',
};

export function describeSignature(signature: string): string {
  if (signature.startsWith('subscription:')) return `reports: ${signature.slice('subscription:'.length)}`;
  return SIGNATURE_LABELS[signature] ?? signature;
}

export function formatTransitionNotification(event: TaskEvent): { title: string; message: string } {
  return {
    title: event.key,
    message: `${describeSignature(event.from)} → ${describeSignature(event.to)}`,
  };
}

// IMPROVEMENTS_HARNESS.md 3.1 — fires one OS notification per newly
// recorded local-state transition (events.ts's recordTransitions already
// does the actual diffing; this just reports what it found). Meant for a
// run with nobody reading the terminal — a scheduled one-shot invocation
// (launchd/systemd --user, see harness/launchd, harness/systemd) or a
// long-running `--watch`. Deliberately does NOT cover staleness crossing a
// threshold or the worker going offline — those are live/derived facts,
// not local-state transitions events.ts's signature tracks (see its own
// comment on why the signature is deliberately not deriveStatus()'s
// label); notifying on those would need extending that signature, left
// for later rather than folded into this pass. Never throws — notify()
// itself already swallows dispatch failures.
export function notifyTransitions(events: TaskEvent[]): void {
  for (const event of events) {
    const { title, message } = formatTransitionNotification(event);
    notify(title, message);
  }
}
