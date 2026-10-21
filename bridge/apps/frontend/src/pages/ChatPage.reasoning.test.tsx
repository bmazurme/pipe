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
  content: string,
  reasoning: string | null = null,
) => ({
  id,
  chatId: 1,
  role,
  content,
  status: 'complete',
  errorMessage: null,
  progress: null,
  reasoning,
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
        return json([message(1, 'user', 'Вопрос'), reply]);

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

describe('ChatPage reasoning', () => {
  it('hides the reasoning behind a toggle, shown alongside the answer once opened', async () => {
    reply = message(2, 'assistant', 'Ответ модели', 'Сначала проверю данные, потом отвечу.');
    const user = userEvent.setup();
    await openChat();

    expect(await screen.findByText('Ответ модели')).toBeTruthy();
    expect(screen.queryByText('Сначала проверю данные, потом отвечу.')).toBeNull();

    const toggle = await screen.findByRole('button', { name: /Thought/i });
    await user.click(toggle);

    expect(await screen.findByText('Сначала проверю данные, потом отвечу.')).toBeTruthy();
    expect(screen.getByText('Ответ модели')).toBeTruthy();
  });

  it('shows no reasoning toggle when the model gave none', async () => {
    reply = message(2, 'assistant', 'Ответ модели');
    await openChat();

    expect(await screen.findByText('Ответ модели')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thought/i })).toBeNull();
  });
});
