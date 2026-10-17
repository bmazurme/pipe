import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ChatPage } from './ChatPage';
import { store } from '../store';
import { chatApi } from '../store/api';

const renders: { id: string }[][] = [];

vi.mock('@gravity-ui/aikit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gravity-ui/aikit')>();
  const Original = actual.ChatContainer;

  return {
    ...actual,
    ChatContainer: (props: React.ComponentProps<typeof Original>) => {
      renders.push((props.messages ?? []) as { id: string }[]);

      return <Original {...props} />;
    },
  };
});

const CHAT = {
  id: 1,
  model: 'sonnet',
  title: 'Чат',
  createdAt: '2026-10-16T09:00:00.000Z',
  updatedAt: '2026-10-16T09:05:00.000Z',
};
const message = (id: number, role: 'user' | 'assistant', status: string, content: string) => ({
  id,
  chatId: 1,
  role,
  content,
  status,
  errorMessage: null,
  progress: null,
  attachments: [],
  createdAt: '2026-10-16T09:00:00.000Z',
  updatedAt: '2026-10-16T09:00:00.000Z',
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  renders.length = 0;
  store.dispatch(chatApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const { url, method } = request;

      if (url.endsWith('/chat/chats') && method === 'GET') return json([CHAT]);
      if (url.includes('/chat/chats/1/messages') && method === 'GET')
        return json([
          message(1, 'user', 'complete', 'Вопрос'),
          message(2, 'assistant', 'complete', 'Первый ответ'),
          message(3, 'user', 'complete', 'Ещё вопрос'),
          { ...message(4, 'assistant', 'pending', ''), createdAt: new Date(Date.now() - 12_000).toISOString() },
        ]);

      return json([]);
    }),
  );
});

describe('ChatPage waiting tick', () => {
  it('keeps finished messages identical from one tick to the next', async () => {
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
    await screen.findByText(/⏳ Ждём свободный worker… \d+ с/);

    const withFour = () => renders.filter((list) => list.length === 4);

    await waitFor(() => expect(new Set(withFour().map((list) => list[3])).size).toBeGreaterThan(1), { timeout: 5000 });

    const lists = withFour();

    for (const list of lists) {
      for (const index of [0, 1, 2]) expect(list[index]).toBe(lists[0][index]);
    }
  }, 15000);
});
