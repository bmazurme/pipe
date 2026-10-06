import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { BriefSections } from './brief.js';
import { formatBrief, summarizeBrief } from './brief.js';

// buildBrief itself is deliberately not exercised here — it always
// requests live data internally (see its own comment on why), and this
// machine's real sync-cli credentials would make that a genuine network
// call to production bridge/GitLab during `npm test`. formatBrief/
// summarizeBrief are pure and cover everything worth a unit test; buildBrief
// was verified manually against this machine's real state instead (see
// harness/README.md's own "Morning brief" section).
function makeSections(overrides: Partial<BriefSections> = {}): BriefSections {
  return {
    incoming: [],
    ready: [],
    stale: [],
    recentEvents: [],
    ...overrides,
  };
}

describe('formatBrief', () => {
  it('shows "none" for every empty section', () => {
    const text = formatBrief(makeSections());

    assert.match(text, /Incoming \(assigned, not yet pushed\):\n {2}none/);
    assert.match(text, /Ready to review:\n {2}none/);
    assert.match(text, /Stale:\n {2}none/);
    assert.match(text, /Moved in the last 24h:\n {2}none/);
  });

  it('lists incoming/ready/stale tasks by key and label', () => {
    const text = formatBrief(
      makeSections({
        incoming: [{ key: '1:5', bucket: 'incoming', label: 'assigned, not yet pushed: Fix it' }],
        ready: [{ key: '1:1', bucket: 'ready', label: 'pulled — ready to publish' }],
        stale: [{ key: '1:2', bucket: 'stale', label: 'pushed ... — no pull since' }],
      }),
    );

    assert.match(text, /1:5: assigned, not yet pushed: Fix it/);
    assert.match(text, /1:1: pulled — ready to publish/);
    assert.match(text, /1:2: pushed \.\.\. — no pull since/);
  });

  it('shows the GitLab error for incoming instead of "none" when the live check failed, never confusing the two', () => {
    const text = formatBrief(makeSections({ gitlabError: 'no GitLab token configured for sync-cli' }));

    assert.match(text, /Incoming \(assigned, not yet pushed\):\n {2}no GitLab token configured/);
  });

  it('never shows bridge\'s own liveError under the incoming (GitLab-sourced) section', () => {
    const text = formatBrief(makeSections({ liveError: 'bridge live check failed: timeout' }));

    assert.match(text, /Incoming \(assigned, not yet pushed\):\n {2}none/);
  });

  it('formats recent events using the same from → to rendering as --notify', () => {
    const text = formatBrief(
      makeSections({
        recentEvents: [{ ts: '2026-10-05T14:34:12.663Z', key: '1:1', source: 'reports (subscription)', from: 'subscription:pushed', to: 'subscription:pulled' }],
      }),
    );

    assert.match(text, /1:1: reports: pushed → reports: pulled/);
  });

  it('shows worker up/down when live, or the liveError when not', () => {
    const up = formatBrief(makeSections({ liveWorker: { isUp: true, workers: [] } }));
    assert.match(up, /Worker:\n {2}up/);

    const down = formatBrief(makeSections({ liveError: 'no bridge API key configured for sync-cli' }));
    assert.match(down, /Worker:\n {2}no bridge API key configured/);
  });

  it('honors a custom recentHours label', () => {
    const text = formatBrief(makeSections(), 48);
    assert.match(text, /Moved in the last 48h:/);
  });
});

describe('summarizeBrief', () => {
  it('produces a short, single-line digest for an OS notification body', () => {
    const summary = summarizeBrief(
      makeSections({
        incoming: [{ key: '1:5', bucket: 'incoming', label: 'x' }],
        ready: [{ key: '1:1', bucket: 'ready', label: 'x' }],
        stale: [{ key: '1:2', bucket: 'stale', label: 'x' }, { key: '1:3', bucket: 'stale', label: 'x' }],
        liveWorker: { isUp: false, workers: [] },
      }),
    );

    assert.equal(summary, '1 incoming, 1 ready, 2 stale, 0 moved recently, worker down');
  });

  it('omits the worker clause entirely when live data was unavailable', () => {
    assert.equal(summarizeBrief(makeSections()), '0 incoming, 0 ready, 0 stale, 0 moved recently');
  });
});
