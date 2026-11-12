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

// The dialog copies through the browser's clipboard; jsdom has none.
function stubClipboard(writeText: () => Promise<void> = async () => undefined) {
  const spy = vi.fn(writeText);

  Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true });

  return spy;
}

const createButton = async () => (await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!;

describe('ApiKeysSection', () => {
  it('shows the created token once and forgets it when the dialog is closed', async () => {
    const user = userEvent.setup();
    const clipboard = stubClipboard();
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

    await user.click(screen.getByRole('button', { name: 'Скопировать ключ' }));
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
    expect(clipboard).toHaveBeenCalledWith('brk_secret-plaintext-token');
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

    await screen.findByText(/Не удалось создать ключ: boom \(HTTP 500\)/);
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

describe('ApiKeysSection boards-only key', () => {
  it('sends scope "boards" when the checkbox is ticked', async () => {
    const user = userEvent.setup();
    const requests: Request[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request.clone());
        if (request.method === 'POST') {
          return jsonResponse({ ...KEYS[0], scope: 'boards', token: 'brk_board-token' });
        }
        return jsonResponse([]);
      }),
    );

    renderSection();
    await screen.findByText('Ключей ещё нет');

    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await user.type(await screen.findByPlaceholderText('sync-cli на ноутбуке'), 'board-1');
    await user.click(screen.getByLabelText('только для плат'));
    await user.click((await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!);

    await screen.findByText('brk_board-token');
    const posts = requests.filter((r) => r.method === 'POST');
    expect(JSON.parse(await posts[0].text())).toEqual({ name: 'board-1', scope: 'boards' });
  });
});

describe('ApiKeysSection expiry', () => {
  it('sends expiresInDays when an expiry is chosen', async () => {
    const user = userEvent.setup();
    const requests: Request[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request.clone());
        if (request.method === 'POST') return jsonResponse({ ...KEYS[0], token: 'brk_x' });
        return jsonResponse([]);
      }),
    );

    renderSection();
    await screen.findByText('Ключей ещё нет');

    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await user.type(await screen.findByPlaceholderText('sync-cli на ноутбуке'), 'sync-cli');
    await user.click(await screen.findByText('Бессрочно'));
    await user.click(await screen.findByText('90 дней'));
    await user.click((await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!);

    await screen.findByText('brk_x');
    const post = requests.find((r) => r.method === 'POST')!;
    expect(JSON.parse(await post.text())).toEqual({ name: 'sync-cli', expiresInDays: 90 });
  });

  it('marks an expired key and shows the date of a live one', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          { ...KEYS[0], expiresAt: '2020-01-01T00:00:00.000Z' },
          { ...KEYS[1], expiresAt: future },
        ]),
      ),
    );

    renderSection();
    await screen.findByText('sync-cli');

    expect(screen.getByText(/истёк/)).toBeTruthy();
    expect(screen.getByText(/действует до \d/)).toBeTruthy();
  });
});

describe('ApiKeysSection new-key dialog', () => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>, token = 'brk_new-token') => {
    const requests: Request[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request.clone());
        if (request.method === 'POST') return jsonResponse({ ...KEYS[0], token });

        return jsonResponse([]);
      }),
    );

    renderSection();
    await screen.findByText('Ключей ещё нет');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await screen.findByPlaceholderText('sync-cli на ноутбуке');

    return requests;
  };

  it('fills the name from a quick choice, and the boards-only switch for the boards agent', async () => {
    const user = userEvent.setup();
    const requests = await openDialog(user);

    await user.click(screen.getByRole('button', { name: 'агент плат' }));
    expect(screen.getByPlaceholderText('sync-cli на ноутбуке')).toHaveValue('агент плат');
    expect(screen.getByLabelText('только для плат')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'reports' }));
    expect(screen.getByPlaceholderText('sync-cli на ноутбуке')).toHaveValue('reports');
    expect(screen.getByLabelText('только для плат')).not.toBeChecked();

    await user.click(await createButton());
    await screen.findByText('brk_new-token');
    expect(JSON.parse(await requests.find((r) => r.method === 'POST')!.text())).toEqual({ name: 'reports' });
  });

  it('creates the key on Enter in the name field', async () => {
    const user = userEvent.setup();
    const requests = await openDialog(user);

    await user.type(screen.getByPlaceholderText('sync-cli на ноутбуке'), 'laptop{Enter}');

    await screen.findByText('brk_new-token');
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('says when the key will stop working, in words', async () => {
    const user = userEvent.setup();

    await openDialog(user);
    expect(screen.getByText(/Работает, пока вы его не отзовёте/)).toBeTruthy();

    await user.click(await screen.findByText('Бессрочно'));
    await user.click(await screen.findByText('30 дней'));
    expect(screen.getByText(/Перестанет работать \d{1,2} \S+ \d{4}/)).toBeTruthy();
  });

  it('asks once more before closing with the token not copied, and keeps it until then', async () => {
    const user = userEvent.setup();

    stubClipboard();

    await openDialog(user, 'brk_unsaved');
    await user.type(screen.getByPlaceholderText('sync-cli на ноутбуке'), 'laptop{Enter}');
    await screen.findByText('brk_unsaved');

    await user.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText(/Вы ещё не скопировали ключ/)).toBeTruthy();
    expect(screen.getByText('brk_unsaved')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Закрыть без копирования' }));
    expect(screen.queryByText('brk_unsaved')).toBeNull();
  });

  it('does not close on Escape until the token is copied or the owner confirms', async () => {
    const user = userEvent.setup();

    stubClipboard();

    await openDialog(user, 'brk_esc');
    await user.type(screen.getByPlaceholderText('sync-cli на ноутбуке'), 'laptop{Enter}');
    await screen.findByText('brk_esc');

    await user.keyboard('{Escape}');
    expect(await screen.findByText(/Вы ещё не скопировали ключ/)).toBeTruthy();
    expect(screen.getByText('brk_esc')).toBeTruthy();
  });

  it('closes at once after the token was copied, and shows the request to test it with the token in it', async () => {
    const user = userEvent.setup();

    stubClipboard();

    await openDialog(user, 'brk_ok');
    await user.type(screen.getByPlaceholderText('sync-cli на ноутбуке'), 'laptop{Enter}');
    await screen.findByText('brk_ok');

    expect(screen.getByText(/X-Api-Key: brk_ok/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Скопировать ключ' }));
    expect(await screen.findByText('Скопировано')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.queryByText('brk_ok')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says so when the browser refuses to copy', async () => {
    const user = userEvent.setup();

    stubClipboard(async () => {
      throw new Error('denied');
    });

    await openDialog(user, 'brk_denied');
    await user.type(screen.getByPlaceholderText('sync-cli на ноутбуке'), 'laptop{Enter}');
    await screen.findByText('brk_denied');

    await user.click(screen.getByRole('button', { name: 'Скопировать ключ' }));
    expect(await screen.findByText(/Браузер не дал скопировать/)).toBeTruthy();
  });
});
