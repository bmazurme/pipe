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
    expect(JSON.parse(await posts[0].text())).toEqual({ name: 'sync-cli', expiresInDays: 90 });
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

describe('ApiKeysSection scopes', () => {
  it('sends scope "boards" when it is chosen', async () => {
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
    await user.click(screen.getByRole('radio', { name: 'Только плат' }));
    await user.click((await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!);

    await screen.findByText('brk_board-token');
    const posts = requests.filter((r) => r.method === 'POST');
    expect(JSON.parse(await posts[0].text())).toEqual({ name: 'board-1', scope: 'boards', expiresInDays: 90 });
  });

  it('sends scope "readonly" for a read-only key, and says what it cannot do', async () => {
    const user = userEvent.setup();
    const requests: Request[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request.clone());
        if (request.method === 'POST') return jsonResponse({ ...KEYS[0], scope: 'readonly', token: 'brk_ro' });
        return jsonResponse([]);
      }),
    );

    renderSection();
    await screen.findByText('Ключей ещё нет');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await user.type(await screen.findByPlaceholderText('sync-cli на ноутбуке'), 'dashboard');
    await user.click(screen.getByRole('radio', { name: 'Только чтение' }));

    expect(screen.getByText(/Менять и удалять нельзя/)).toBeTruthy();

    await user.click((await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!);
    await screen.findByText('brk_ro');
    expect(JSON.parse(await requests.find((r) => r.method === 'POST')!.text())).toEqual({ name: 'dashboard', scope: 'readonly', expiresInDays: 90 });
  });

  it('shows the scope of a key in the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{ ...KEYS[1], scope: 'reports-sync', lastUsedAt: new Date().toISOString() }])));

    renderSection();

    expect(await screen.findByText(/для reports \(sync\)/)).toBeTruthy();
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
    await user.click(await screen.findByText('90 дней (по умолчанию)'));
    await user.click(await screen.findByText('30 дней'));
    await user.click((await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!);

    await screen.findByText('brk_x');
    const post = requests.find((r) => r.method === 'POST')!;
    expect(JSON.parse(await post.text())).toEqual({ name: 'sync-cli', expiresInDays: 30 });
  });

  it('sends null, and warns, when «never» is chosen on purpose', async () => {
    const user = userEvent.setup();
    const requests: Request[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request.clone());
        if (request.method === 'POST') return jsonResponse({ ...KEYS[0], token: 'brk_forever' });
        return jsonResponse([]);
      }),
    );

    renderSection();
    await screen.findByText('Ключей ещё нет');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    await user.type(await screen.findByPlaceholderText('sync-cli на ноутбуке'), 'forever');
    await user.click(await screen.findByText('90 дней (по умолчанию)'));
    await user.click(await screen.findByText('Бессрочно (осознанно)'));

    expect(screen.getByText(/Бессрочный ключ — осознанный выбор/)).toBeTruthy();

    await user.click((await screen.findAllByRole('button', { name: 'Создать' })).at(-1)!);
    await screen.findByText('brk_forever');
    expect(JSON.parse(await requests.find((r) => r.method === 'POST')!.text())).toEqual({ name: 'forever', expiresInDays: null });
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

  it('fills the name from a quick choice, and the scope that integration needs', async () => {
    const user = userEvent.setup();
    const requests = await openDialog(user);

    await user.click(screen.getByRole('button', { name: 'агент плат' }));
    expect(screen.getByPlaceholderText('sync-cli на ноутбуке')).toHaveValue('агент плат');
    expect(screen.getByRole('radio', { name: 'Только плат' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'reports' }));
    expect(screen.getByPlaceholderText('sync-cli на ноутбуке')).toHaveValue('reports');
    expect(screen.getByRole('radio', { name: 'reports (sync)' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'sync-cli' }));
    expect(screen.getByRole('radio', { name: 'Полный доступ' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'reports' }));
    await user.click(await createButton());
    await screen.findByText('brk_new-token');
    expect(JSON.parse(await requests.find((r) => r.method === 'POST')!.text())).toEqual({ name: 'reports', scope: 'reports-sync', expiresInDays: 90 });
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
    // 90 days is what is chosen from the start, with its date and the reminder promise
    expect(screen.getByText(/Перестанет работать \d{1,2} \S+ \d{4}/)).toBeTruthy();
    expect(screen.getByText(/придёт напоминание в Telegram/)).toBeTruthy();

    await user.click(await screen.findByText('90 дней (по умолчанию)'));
    await user.click(await screen.findByText('Бессрочно (осознанно)'));
    expect(screen.getByText(/Бессрочный ключ — осознанный выбор/)).toBeTruthy();
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

describe('ApiKeysSection rotation (S5)', () => {
  const stubRotation = (rotateAnswer: () => Response) => {
    const requests: Request[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request.clone());
        if (request.method === 'POST' && request.url.endsWith('/rotate')) return rotateAnswer();

        return jsonResponse([{ ...KEYS[0], scope: 'reports-sync', lastUsedAt: new Date().toISOString() }]);
      }),
    );

    return requests;
  };

  it('asks first, says what happens to the old key, and sends nothing until confirmed', async () => {
    const user = userEvent.setup();
    const requests = stubRotation(() => jsonResponse({ ...KEYS[0], token: 'brk_rotated' }));

    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Перевыпустить ключ: sync-cli' }));

    expect(await screen.findByText('Перевыпустить ключ «sync-cli»?')).toBeTruthy();
    expect(screen.getByText(/прежний перестанет работать сразу/)).toBeTruthy();
    expect(requests.some((r) => r.url.endsWith('/rotate'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(requests.some((r) => r.url.endsWith('/rotate'))).toBe(false);
  });

  it('shows the new token once, with the note that the old key was checked dead', async () => {
    const user = userEvent.setup();
    const requests = stubRotation(() => jsonResponse({ ...KEYS[0], scope: 'reports-sync', expiresAt: '2027-02-10T00:00:00Z', token: 'brk_rotated-secret' }, 201));

    stubClipboard();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Перевыпустить ключ: sync-cli' }));
    await user.click(await screen.findByRole('button', { name: 'Перевыпустить' }));

    expect(await screen.findByText('brk_rotated-secret')).toBeTruthy();
    expect(screen.getByText('Ключ перевыпущен')).toBeTruthy();
    expect(screen.getByText('Старый ключ проверен: он больше не работает.')).toBeTruthy();
    expect(screen.getAllByText(/для reports \(sync\)/).length).toBeGreaterThan(0);
    expect(requests.some((r) => r.method === 'POST' && r.url.endsWith('/auth/api-keys/1/rotate'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Скопировать ключ' }));
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.queryByText('brk_rotated-secret')).toBeNull();
  });

  it('asks once more before closing with the new token not copied', async () => {
    const user = userEvent.setup();

    stubRotation(() => jsonResponse({ ...KEYS[0], token: 'brk_unsaved-rotation' }, 201));
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Перевыпустить ключ: sync-cli' }));
    await user.click(await screen.findByRole('button', { name: 'Перевыпустить' }));
    await screen.findByText('brk_unsaved-rotation');
    await user.click(screen.getByRole('button', { name: 'Готово' }));

    expect(screen.getByText('brk_unsaved-rotation')).toBeTruthy();
    expect(screen.getByText(/Вы ещё не скопировали ключ/)).toBeTruthy();
  });

  it('says the old key was left as it was when the rotation fails', async () => {
    const user = userEvent.setup();

    stubRotation(() => jsonResponse({ message: 'The old key could not be revoked, so nothing was changed' }, 500));
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Перевыпустить ключ: sync-cli' }));
    await user.click(await screen.findByRole('button', { name: 'Перевыпустить' }));

    expect(await screen.findByText(/Старый ключ остался как был/)).toBeTruthy();
  });

  it('says a key nobody used for a month is probably forgotten', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{ ...KEYS[0], lastUsedAt: new Date(Date.now() - 45 * 86_400_000).toISOString() }])));

    renderSection();

    expect(await screen.findByText(/Не использовался 45 дн\./)).toBeTruthy();
  });
});
