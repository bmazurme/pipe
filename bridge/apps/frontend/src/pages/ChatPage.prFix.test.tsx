import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ChatPage } from './ChatPage';
import { store } from '../store';
import { chatApi, improveApi } from '../store/api';

const CHAT = { id: 1, model: 'opus', title: 'Чат #4', createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:05:00.000Z' };
const message = (id: number, role: 'user' | 'assistant', content: string) => ({
  id,
  chatId: 1,
  role,
  content,
  status: 'complete',
  errorMessage: null,
  attachments: [],
  createdAt: CHAT.createdAt,
  updatedAt: CHAT.createdAt,
});
const PROPOSAL =
  'Предлагаю правку.\n\n```pipe-action\n{"type":"fix-pr","pr":304,"instruction":"Rename the helper"}\n```';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let started: unknown[];
let startStatus: number;

beforeEach(() => {
  started = [];
  startStatus = 201;
  store.dispatch(chatApi.util.resetApiState());
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const { url, method } = request;

      if (url.endsWith('/chat/chats') && method === 'GET') return jsonResponse([CHAT]);
      if (url.includes('/chat/chats/1/messages') && method === 'GET') {
        return jsonResponse([message(1, 'user', 'исправь PR 304'), message(2, 'assistant', PROPOSAL)]);
      }
      if (url.endsWith('/improve/pr-fix')) {
        started.push(JSON.parse(await request.clone().text()));

        return startStatus === 201 ? jsonResponse({ id: 77 }, 201) : jsonResponse({ message: 'PR #304 уже исправляется' }, startStatus);
      }

      return jsonResponse([]);
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

  // The history opens from the header; the chat is picked from it.
  await screen.findByText('Chat');
  await waitFor(() => expect(document.querySelector('[data-qa="header-action-history"]')).toBeTruthy());
  await user.click(document.querySelector('[data-qa="header-action-history"]') as Element);
  await user.click(await screen.findByText('Чат #4'));

  return user;
}

describe('ChatPage pull request change proposed by the model', () => {
  it('shows the proposal as a card, keeps the raw block out of the text, and starts nothing by itself', async () => {
    await openChat();

    expect(await screen.findByText('Предложена правка PR #304')).toBeTruthy();
    expect(screen.getByText('Rename the helper')).toBeTruthy();
    expect(screen.getByText('Предлагаю правку.')).toBeTruthy();
    expect(screen.queryByText(/pipe-action/)).toBeNull();
    expect(started).toEqual([]);
  });

  it('starts the change with the chat model only after "Запустить"', async () => {
    const user = await openChat();

    await user.click(await screen.findByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(started).toEqual([{ prNumber: 304, instruction: 'Rename the helper', model: 'opus' }]));
    expect(await screen.findByText(/запущена \(запуск #77\)/)).toBeTruthy();
  });

  it('says why it could not start, and can be tried again', async () => {
    const user = await openChat();

    startStatus = 409;
    await user.click(await screen.findByRole('button', { name: 'Запустить' }));

    expect(await screen.findByText('PR #304 уже исправляется')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Запустить' })).toBeTruthy();
  });

  it('puts the card away on "Не нужно"', async () => {
    const user = await openChat();

    await user.click(await screen.findByRole('button', { name: 'Не нужно' }));

    expect(screen.queryByText('Предложена правка PR #304')).toBeNull();
    expect(started).toEqual([]);
  });
});
