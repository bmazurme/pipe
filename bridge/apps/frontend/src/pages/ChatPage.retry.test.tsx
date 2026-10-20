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
const message = (id: number, role: 'user' | 'assistant', status: string, content: string, errorMessage: string | null = null) => ({
  id,
  chatId: 1,
  role,
  content,
  status,
  errorMessage,
  progress: null,
  attachments: [],
  createdAt: new Date(Date.now() - 60_000 + id * 1000).toISOString(),
  updatedAt: new Date(Date.now() + id * 1000).toISOString(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let thread: ReturnType<typeof message>[];
let retryCalls: string[];

beforeEach(() => {
  store.dispatch(chatApi.util.resetApiState());
  retryCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const { url, method } = request;

      if (url.endsWith('/chat/chats') && method === 'GET') return json([CHAT]);
      if (url.includes('/chat/chats/1/messages') && method === 'GET') return json(thread);
      if (url.includes('/chat/messages/') && url.endsWith('/retry') && method === 'POST') {
        retryCalls.push(url);
        const last = thread[thread.length - 1];
        thread = [...thread.slice(0, -1), { ...last, status: 'pending', errorMessage: null, updatedAt: new Date(Date.now() + 99_000).toISOString() }];

        return json(thread[thread.length - 1]);
      }

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

  return user;
}

describe('ChatPage retry of a failed reply', () => {
  it('re-runs the last failed reply, which then shows the waiting state', async () => {
    thread = [message(1, 'user', 'complete', 'Вопрос'), message(2, 'assistant', 'failed', '', 'Worker was stopped (SIGTERM)')];
    const user = await openChat();

    await user.click(await screen.findByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(retryCalls).toHaveLength(1));
    expect(retryCalls[0]).toMatch(/\/chat\/messages\/2\/retry$/);
    expect(await screen.findByText(/⏳ Ждём свободный worker… \d+ с/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('offers no button for an older failed reply', async () => {
    thread = [
      message(1, 'user', 'complete', 'Вопрос'),
      message(2, 'assistant', 'failed', '', 'boom'),
      message(3, 'user', 'complete', 'Ещё вопрос'),
      message(4, 'assistant', 'complete', 'Ответ'),
    ];
    await openChat();

    expect(await screen.findByText('Ответ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });
});
