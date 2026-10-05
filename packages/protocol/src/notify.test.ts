import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatFallback } from './notify.js';

// notify()'s actual OS dispatch (osascript/notify-send) is intentionally not
// exercised here: running it for real would either fire a genuine desktop
// notification on whoever runs the test suite, or spawn a subprocess that
// doesn't exist on a bare CI runner. It's inspected, not tested.
describe('formatFallback', () => {
  it('includes the title and message with a bell marker', () => {
    const text = formatFallback('Result ready', 'Issue #628 pulled');

    assert.match(text, /Result ready/);
    assert.match(text, /Issue #628 pulled/);
    assert.match(text, /\u{1F514}/u);
  });
});
