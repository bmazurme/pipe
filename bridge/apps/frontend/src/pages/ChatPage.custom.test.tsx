import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ChatPage } from './ChatPage';
import { store } from '../store';
import { chatApi, workerApi } from '../store/api';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const KEYS = [
  { id: 9, provider: 'custom', name: 'Mac M2', model: 'qwen2.5-coder:7b', keyHint: '' },
  { id: 12, provider: 'custom', name: 'Yandex', model: 'yandexgpt', keyHint: '…1234' },
  { id: 3, provider: 'gpt', name: 'рабочий', model: null, keyHint: '…abcd' },
];

let keys: unknown[];
let posted: unknown;

beforeEach(() => {
  keys = KEYS;
  posted = undefined;
  store.dispatch(chatApi.util.resetApiState());
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '');

      if (path === '/worker/provider-credentials') return json(keys);
      if (path === '/chat/chats' && request.method === 'POST') {
        posted = JSON.parse(await request.clone().text());

        return json({ id: 1, model: 'custom', providerCredentialId: 12, title: null, createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z' });
      }

      return json([]);
    }),
  );
});

const renderPage = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <ChatPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

async function pickCustom(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Chat');
  await user.click(screen.getByText('Claude Sonnet'));
  await user.click(await screen.findByText('Другая модель'));
}

describe('ChatPage — a custom model', () => {
  it('offers the custom keys only, preselects the first, and creates the chat on the chosen one', async () => {
    const user = userEvent.setup();

    renderPage();
    await pickCustom(user);

    expect(await screen.findByText('Mac M2 · qwen2.5-coder:7b')).toBeTruthy();
    expect(screen.queryByText('рабочий')).toBeNull();

    await user.click(screen.getByText('Mac M2 · qwen2.5-coder:7b'));
    await user.click(await screen.findByText('Yandex · yandexgpt'));
    await user.type(screen.getByPlaceholderText('Напишите сообщение…'), 'Привет{Enter}');

    await waitFor(() => expect(posted).toEqual({ model: 'custom', providerCredentialId: 12 }));
  });

  it('creates the chat on the first key when none was touched', async () => {
    const user = userEvent.setup();

    renderPage();
    await pickCustom(user);
    await screen.findByText('Mac M2 · qwen2.5-coder:7b');
    await user.type(screen.getByPlaceholderText('Напишите сообщение…'), 'Привет{Enter}');

    await waitFor(() => expect(posted).toEqual({ model: 'custom', providerCredentialId: 9 }));
  });

  it('points to where a key is added when there is none, and sends no key for another model', async () => {
    const user = userEvent.setup();

    keys = [KEYS[2]];
    renderPage();
    await pickCustom(user);

    expect(await screen.findByRole('link', { name: 'Добавить ключ модели' })).toBeTruthy();
  });
});
