import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ApiKeysSection } from './ApiKeysSection';
import { apiKeysApi } from '../../store/api';
import apiKeysReducer from '../../store/slices/api-keys-slice';
import authReducer from '../../store/slices/auth-slice';

const KEYS = [
  { id: 1, name: 'sync-cli', prefix: 'brk_aaa', createdAt: '2026-09-30T07:00:00.000Z', lastUsedAt: null },
  { id: 2, name: 'reports', prefix: 'brk_bbb', createdAt: '2026-09-30T08:00:00.000Z', lastUsedAt: null },
];

// A fresh store per test: the real one keeps the keys slice between tests.
function renderSection() {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      apiKeys: apiKeysReducer,
      [apiKeysApi.reducerPath]: apiKeysApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(apiKeysApi.middleware),
  });

  return render(
    // The section is typed against the app's RootState, which this slim store does not match.
    <Provider store={store as never}>
      <ThemeProvider theme="light">
        <ApiKeysSection />
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiKeysSection', () => {
  it('shows the created token once and forgets it when the dialog is closed', async () => {
    const user = userEvent.setup();
    const requests: Request[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request.clone());
        if (request.method === 'POST') {
          return jsonResponse({ ...KEYS[0], token: 'brk_secret-plaintext-token' });
        }
        return jsonResponse([]);
      }),
    );

    renderSection();
    await screen.findByText('Ключей ещё нет');

    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await user.type(await screen.findByPlaceholderText('sync-cli на ноутбуке'), 'sync-cli');
    await user.click((await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!);

    await screen.findByText('brk_secret-plaintext-token');
    expect(screen.getByText('Ключ создан')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Готово' }));
    // Immediately, not eventually: the dialog is still mid-exit-transition here, so
    // only clearing the token on close (not merely on re-open) makes this pass.
    expect(screen.queryByText('brk_secret-plaintext-token')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Создать' }));
    const input = (await screen.findByPlaceholderText('sync-cli на ноутбуке')) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.queryByText('brk_secret-plaintext-token')).toBeNull();
    expect(screen.queryByText('Ключ создан')).toBeNull();

    const posts = requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(await posts[0].text())).toEqual({ name: 'sync-cli' });
  });

  it('sends no request for a blank or whitespace name', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    renderSection();
    await screen.findByText('Ключей ещё нет');

    await user.click(screen.getByRole('button', { name: 'Создать' }));
    const input = await screen.findByPlaceholderText('sync-cli на ноутбуке');
    const apply = (await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!;
    expect((apply as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, '   ');
    await user.click(apply);

    const calls = fetchMock.mock.calls as unknown as [Request][];
    expect(calls.filter(([request]) => request.method === 'POST')).toHaveLength(0);
  });

  it('shows the create error inside the dialog when creation fails', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'POST') return jsonResponse({ message: 'boom' }, 500);
        return jsonResponse([]);
      }),
    );

    renderSection();
    await screen.findByText('Ключей ещё нет');

    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await user.type(await screen.findByPlaceholderText('sync-cli на ноутбуке'), 'sync-cli');
    await user.click((await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!);

    await screen.findByText('Не удалось создать ключ');
    expect(screen.getByPlaceholderText('sync-cli на ноутбуке')).toBeTruthy();
  });

  it('shows the revoke error and keeps the row when revoking fails', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'DELETE') return jsonResponse({ message: 'boom' }, 500);
        return jsonResponse(KEYS);
      }),
    );

    renderSection();
    await screen.findByText('sync-cli');

    await user.click(screen.getByRole('button', { name: 'Отозвать ключ: sync-cli' }));

    await screen.findByText('Не удалось отозвать ключ');
    expect(screen.getByText('sync-cli')).toBeTruthy();
    expect(screen.getByText('reports')).toBeTruthy();
  });

  it('disables the other keys while one key is being revoked', async () => {
    const user = userEvent.setup();
    let finishRevoke: () => void = () => {};
    const revokeGate = new Promise<void>((resolve) => {
      finishRevoke = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.method === 'DELETE') {
          await revokeGate;
          return new Response(null, { status: 204 });
        }
        return jsonResponse(KEYS);
      }),
    );

    renderSection();
    await screen.findByText('sync-cli');

    await user.click(screen.getByRole('button', { name: 'Отозвать ключ: sync-cli' }));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Отозвать ключ: reports' }) as HTMLButtonElement).disabled).toBe(true),
    );

    finishRevoke();
    await waitFor(() => expect(screen.queryByText('sync-cli')).toBeNull());
    expect((screen.getByRole('button', { name: 'Отозвать ключ: reports' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the load error and not the empty state when the list fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'boom' }, 500)));

    renderSection();

    await screen.findByText('Не удалось загрузить список ключей');
    expect(screen.queryByText('Ключей ещё нет')).toBeNull();
  });
});
