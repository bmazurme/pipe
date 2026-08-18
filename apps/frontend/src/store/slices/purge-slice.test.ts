import { describe, expect, it } from 'vitest';

import purgeReducer, { draftTextChanged } from './purge-slice';

describe('purgeReducer', () => {
  it('starts with an empty draft and no entries', () => {
    const state = purgeReducer(undefined, { type: '@@INIT' });
    expect(state.entries).toEqual([]);
    expect(state.text).toBe('');
    expect(state.lastSyncedText).toBe('');
  });

  it('draftTextChanged updates text without touching lastSyncedText', () => {
    // This divergence is exactly what PurgePage's hasPendingSave guard
    // (text !== lastSyncedText) relies on to pause the cross-device poll
    // while there's an unsent local edit.
    const state = purgeReducer(undefined, draftTextChanged('hello'));
    expect(state.text).toBe('hello');
    expect(state.lastSyncedText).toBe('');
  });
});
