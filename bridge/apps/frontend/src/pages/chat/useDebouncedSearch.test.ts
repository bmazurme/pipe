import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedSearch } from './useDebouncedSearch';

describe('useDebouncedSearch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for typing to settle and ignores one-character input', () => {
    const { result, rerender } = renderHook(({ text }) => useDebouncedSearch(text), { initialProps: { text: '' } });

    rerender({ text: 'fo' });
    expect(result.current).toBe('');
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current).toBe('fo');

    rerender({ text: 'f' });
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current).toBe('');
  });

  it('restores an empty query when the field is cleared', () => {
    const { result, rerender } = renderHook(({ text }) => useDebouncedSearch(text), { initialProps: { text: 'foo' } });
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current).toBe('foo');

    rerender({ text: '' });
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current).toBe('');
  });
});
