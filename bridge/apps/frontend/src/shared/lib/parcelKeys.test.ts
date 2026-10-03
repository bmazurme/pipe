import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useParcelKeys } from './parcelKeys';

describe('useParcelKeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    const { result } = renderHook(() => useParcelKeys());
    expect(result.current.keys).toEqual([]);
  });

  it('adds a key and persists it to localStorage', () => {
    const { result } = renderHook(() => useParcelKeys());

    act(() => {
      result.current.addKey('personal', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
    });

    expect(result.current.keys).toHaveLength(1);
    expect(result.current.keys[0].name).toBe('personal');

    const { result: fresh } = renderHook(() => useParcelKeys());
    expect(fresh.current.keys).toHaveLength(1);
  });

  it('removes a key by id', () => {
    const { result } = renderHook(() => useParcelKeys());

    act(() => {
      result.current.addKey('a', 'pem-a');
    });
    act(() => {
      result.current.addKey('b', 'pem-b');
    });

    const idToRemove = result.current.keys.find((key) => key.name === 'a')!.id;

    act(() => {
      result.current.removeKey(idToRemove);
    });

    expect(result.current.keys).toHaveLength(1);
    expect(result.current.keys[0].name).toBe('b');
  });
});
