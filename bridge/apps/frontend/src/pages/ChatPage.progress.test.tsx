import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ChatPage } from './ChatPage';
import { store } from '../store';
import { chatApi } from '../store/api';

const CHAT = {
  id: 1,
  model: 'sonnet',
  title: 'Чат',
  createdAt: '2026-10-16T09:00:00.000Z',
  updatedAt: '2026-10-16T09:05:00.000Z',
};
const message = (
  id: number,
  role: 'user' | 'assistant',
  status: string,
  content: string,
  progress: string | null = null,
) => ({
  id,
  chatId: 1,
  role,
  content,
  status,
  errorMessage: null,
  progress,
  attachments: [],
  createdAt: new Date(Date.now() - 12_000).toISOString(),
  updatedAt: new Date().toISOString(),
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
let reply: ReturnType<typeof message>;

beforeEach(() => {
  store.dispatch(chatApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const { url, method } = request;

      if (url.endsWith('/chat/chats') && method === 'GET') return json([CHAT]);
      if (url.includes('/chat/chats/1/messages') && method === 'GET')
        return json([message(1, 'user', 'complete', 'Вопрос'), reply]);

      return json([]);
    }),
  );
});

async function openChat() {
  const user = userEvent.setup();

  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <ChatPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

  await screen.findByText('Chat');
  await waitFor(() => expect(document.querySelector('[data-qa="header-action-history"]')).toBeTruthy());
  await user.click(document.querySelector('[data-qa="header-action-history"]') as Element);
  await user.click(await screen.findByText('Чат'));
}

describe('ChatPage reply in progress', () => {
  it('shows the reply as far as the model has written it', async () => {
    reply = message(2, 'assistant', 'running', '', 'Первые слова ответа');
    await openChat();

    expect(await screen.findByText('Первые слова ответа')).toBeTruthy();
  });

  it('before the first words says that the model is working, and for how long', async () => {
    reply = message(2, 'assistant', 'running', '', null);
    await openChat();

    expect(await screen.findByText(/⏳ Модель работает… \d+ с/)).toBeTruthy();
  });

  it('says that it waits for a worker while nobody has taken the turn', async () => {
    reply = message(2, 'assistant', 'pending', '', null);
    await openChat();

    expect(await screen.findByText(/⏳ Ждём свободный worker… \d+ с/)).toBeTruthy();
  });

  it('hides a half-written action block from the partial reply', async () => {
    reply = message(2, 'assistant', 'running', '', 'Предлагаю правку.\n\n```pipe-action\n{"type":"fix-pr"');
    await openChat();

    expect(await screen.findByText('Предлагаю правку.')).toBeTruthy();
    expect(screen.queryByText(/pipe-action/)).toBeNull();
  });

  it('shows the finished reply, not the progress, once it is complete', async () => {
    reply = message(2, 'assistant', 'complete', 'Готовый ответ', 'устаревший прогресс');
    await openChat();

    expect(await screen.findByText('Готовый ответ')).toBeTruthy();
    expect(screen.queryByText('устаревший прогресс')).toBeNull();
  });
});
