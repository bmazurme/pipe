import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ChatPage } from './ChatPage';
import { store } from '../../store';
import { chatApi } from '../../store/api';

const KEY = 'ghp_AbCdEfGhIjKlMnOpQrSt1234';
const CHAT = { id: 1, model: 'gpt', title: 'Тестовый чат', createdAt: '2026-09-30T09:00:00.000Z', updatedAt: '2026-09-30T09:05:00.000Z' };

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let created: unknown[];
let sent: unknown[];

beforeEach(() => {
  store.dispatch(chatApi.util.resetApiState());
  created = [];
  sent = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const { url, method } = request;

      if (url.endsWith('/chat/chats') && method === 'GET') return json([]);
      if (url.endsWith('/chat/chats') && method === 'POST') {
        created.push(JSON.parse(await request.clone().text()));

        return json(CHAT);
      }
      if (url.includes('/chat/chats/1/messages') && method === 'POST') {
        sent.push(JSON.parse(await request.clone().text()));

        return json({ userMessage: { id: 10, chatId: 1, role: 'user', content: 'x', status: 'complete', errorMessage: null, createdAt: CHAT.createdAt, updatedAt: CHAT.createdAt }, assistantMessage: { id: 11, chatId: 1, role: 'assistant', content: '', status: 'pending', errorMessage: null, createdAt: CHAT.createdAt, updatedAt: CHAT.createdAt } });
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

describe('ChatPage — a message that carries a key', () => {
  it('is not sent: the warning names what was found and shows the message with the key hidden', async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Chat');
    await user.type(screen.getByPlaceholderText('Напишите сообщение…'), `клонируй с ${KEY}{Enter}`);

    expect(await screen.findByText('Сообщение похоже на ключ или пароль — не отправлено')).toBeTruthy();
    expect(screen.getByText(/токен GitHub \(ghp_\*\*\*\)/)).toBeTruthy();
    expect(screen.getByText('«клонируй с [скрыто: токен GitHub]»')).toBeTruthy();
    expect(document.body.textContent).not.toContain('AbCdEf');
    expect(created).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('goes out with the key hidden on "Скрыть и отправить", and not at all on "Не отправлять"', async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Chat');
    const composer = screen.getByPlaceholderText('Напишите сообщение…');

    await user.type(composer, `первый ${KEY}{Enter}`);
    await user.click(await screen.findByRole('button', { name: 'Не отправлять' }));
    expect(screen.queryByText('Сообщение похоже на ключ или пароль — не отправлено')).toBeNull();
    expect(sent).toEqual([]);

    await user.type(screen.getByPlaceholderText('Напишите сообщение…'), `второй ${KEY}{Enter}`);
    await user.click(await screen.findByRole('button', { name: 'Скрыть и отправить' }));

    await waitFor(() => expect(sent).toEqual([{ content: 'второй [скрыто: токен GitHub]' }]));
    expect(screen.queryByText('Сообщение похоже на ключ или пароль — не отправлено')).toBeNull();
  });
});
