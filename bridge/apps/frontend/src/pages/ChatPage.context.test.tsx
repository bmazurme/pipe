import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ChatPage } from './ChatPage';
import { store } from '../store';
import { chatApi, contextApi } from '../store/api';

const CONTEXTS = [
  { id: 4, name: 'Правила проекта', contentLength: 10, createdAt: '2026-09-30T09:00:00.000Z', updatedAt: '2026-09-30T09:00:00.000Z' },
];

const CHAT = {
  id: 1,
  model: 'sonnet',
  title: 'Чат с контекстом',
  contextName: 'Правила проекта',
  createdAt: '2026-09-30T09:00:00.000Z',
  updatedAt: '2026-09-30T09:05:00.000Z',
};

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <ChatPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  store.dispatch(chatApi.util.resetApiState());
  store.dispatch(contextApi.util.resetApiState());
});

describe('ChatPage context', () => {
  it('sends the picked context as contextId when the first message creates the chat', async () => {
    const user = userEvent.setup();
    let createBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.endsWith('/contexts') && method === 'GET') return jsonResponse(CONTEXTS);
        if (url.endsWith('/chat/chats') && method === 'GET') return jsonResponse([]);
        if (url.endsWith('/chat/chats') && method === 'POST') {
          createBody = JSON.parse(await request.clone().text());
          return jsonResponse(CHAT);
        }

        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Chat');

    await user.click(await screen.findByText('Без контекста'));
    await user.click(await screen.findByText('Правила проекта'));
    await user.type(screen.getByPlaceholderText('Напишите сообщение…'), 'Привет{Enter}');

    await waitFor(() => expect(createBody).toEqual({ model: 'sonnet', contextId: 4 }));
  });

  it('shows the context name of an active chat instead of a picker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.endsWith('/contexts') && method === 'GET') return jsonResponse(CONTEXTS);
        if (url.endsWith('/chat/chats') && method === 'GET') return jsonResponse([CHAT]);

        return jsonResponse([]);
      }),
    );

    renderPage();

    const historyButtonEl = document.querySelector('[data-qa="header-action-history"]');
    if (!historyButtonEl) throw new Error('history button not found');
    const user = userEvent.setup();
    await user.click(historyButtonEl);
    await user.click(await screen.findByText(CHAT.title));

    expect(await screen.findByText('Контекст:')).toBeTruthy();
    expect(screen.getByText('Правила проекта')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Контекст' })).toBeNull();
  });
});
