import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import { store } from '../../store';
import { workerApi } from '../../store/api';
import { useModelOptions } from './useModelOptions';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

let keys: unknown;

beforeEach(() => {
  keys = [
    { id: 9, provider: 'custom', name: 'Mac M2', model: 'qwen2.5-coder:7b' },
    { id: 12, provider: 'custom', name: 'Yandex', model: null },
    { id: 3, provider: 'gpt', name: 'рабочий', model: null },
  ];
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal('fetch', vi.fn(async () => json(keys)));
});

describe('useModelOptions (the model pickers of Improve and Lab)', () => {
  it('offers the named models and each custom key as a model of its own — never the bare "custom"', async () => {
    const { result } = renderHook(() => useModelOptions(), { wrapper });

    await waitFor(() => expect(result.current.options.some((option) => option.value === 'custom:9')).toBe(true));

    expect(result.current.options.map((option) => option.value)).toEqual(['sonnet', 'opus', 'haiku', 'gpt', 'deepseek', 'qwen', 'custom:9', 'custom:12']);
    expect(result.current.options.find((option) => option.value === 'custom:9')?.content).toBe('Mac M2 · qwen2.5-coder:7b');
    expect(result.current.options.find((option) => option.value === 'custom:12')?.content).toBe('Yandex');
  });

  it('names a model by its key, and says so when the key is gone', async () => {
    const { result } = renderHook(() => useModelOptions(), { wrapper });

    await waitFor(() => expect(result.current.label('custom:9')).toBe('Mac M2 · qwen2.5-coder:7b'));

    expect(result.current.label('sonnet')).toBe('Claude Sonnet');
    expect(result.current.label('custom:77')).toBe('Своя модель (ключ #77)');
    expect(result.current.label('weird')).toBe('weird');
  });

  it('still lists the named models when the keys cannot be read', async () => {
    keys = { message: 'boom' };
    const { result } = renderHook(() => useModelOptions(), { wrapper });

    expect(result.current.options.map((option) => option.value)).toEqual(['sonnet', 'opus', 'haiku', 'gpt', 'deepseek', 'qwen']);
  });
});
