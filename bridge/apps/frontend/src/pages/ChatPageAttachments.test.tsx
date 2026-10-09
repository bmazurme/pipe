import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ChatPage } from './ChatPage';
import { store } from '../store';
import { chatApi } from '../store/api';

const CHAT = { id: 1, model: 'sonnet', title: null, createdAt: '2026-10-09T09:00:00.000Z', updatedAt: '2026-10-09T09:00:00.000Z' };
const UPLOADED = { id: 7, name: 'error.png', size: 4096, isImage: true, messageId: null };
const SENT_MESSAGE = { id: 10, chatId: 1, role: 'user', content: 'Что тут не так?', status: 'complete', errorMessage: null, attachments: [], createdAt: CHAT.createdAt, updatedAt: CHAT.createdAt };

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let uploadStatus: number;
let uploadMessage: string;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// RTK Query hands fetch a Request; the attachment helpers call fetch(url, init) directly.
async function describeCall(input: unknown, init?: RequestInit): Promise<Call> {
  if (typeof input === 'string') return { method: init?.method ?? 'GET', url: input, body: init?.body instanceof FormData ? 'form-data' : init?.body };

  const request = input as Request;
  const text = request.method === 'GET' ? '' : await request.clone().text();

  return { method: request.method, url: request.url, body: text ? JSON.parse(text) : undefined };
}

beforeEach(() => {
  calls = [];
  uploadStatus = 201;
  uploadMessage = '';
  store.dispatch(chatApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const call = await describeCall(input, init);

      calls.push(call);

      if (call.url.endsWith('/chat/chats') && call.method === 'GET') return json([]);
      if (call.url.endsWith('/chat/chats') && call.method === 'POST') return json(CHAT);
      if (call.url.endsWith('/chat/chats/1/attachments')) return uploadStatus === 201 ? json(UPLOADED, 201) : json({ message: uploadMessage }, uploadStatus);
      if (call.url.includes('/chat/attachments/') && call.method === 'DELETE') return new Response(null, { status: 204 });
      if (call.url.endsWith('/chat/chats/1/messages') && call.method === 'POST') return json({ userMessage: SENT_MESSAGE, assistantMessage: { ...SENT_MESSAGE, id: 11, role: 'assistant', content: '', status: 'pending' } });
      if (call.url.includes('/chat/chats/1/messages')) return json([]);

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

const fileInput = () => screen.getByLabelText('Выбор файлов для вложения') as HTMLInputElement;
const png = (name = 'error.png') => new File(['x'], name, { type: 'image/png' });

describe('Chat attachments', () => {
  it('offers the paperclip in a Claude chat', async () => {
    renderPage();

    const button = await screen.findByRole('button', { name: 'Прикрепить файл' });

    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('starts the chat, uploads the file to it, and shows it as a removable chip', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Прикрепить файл' });

    await user.upload(fileInput(), png());

    expect(await screen.findByText('error.png')).toBeTruthy();
    expect(calls.find((call) => call.url.endsWith('/chat/chats') && call.method === 'POST')?.body).toEqual({ model: 'sonnet' });
    expect(calls.some((call) => call.url.endsWith('/chat/chats/1/attachments') && call.method === 'POST')).toBe(true);
  });

  it('sends the uploaded files with the message', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Прикрепить файл' });

    await user.upload(fileInput(), png());
    await screen.findByText('error.png');
    await user.type(screen.getByPlaceholderText('Напишите сообщение…'), 'Что тут не так?{Enter}');

    await waitFor(() =>
      expect(calls.find((call) => call.url.endsWith('/chat/chats/1/messages') && call.method === 'POST')?.body).toEqual({ content: 'Что тут не так?', attachmentIds: [7] }),
    );
  });

  it('sends a plain message without an attachmentIds field', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByPlaceholderText('Напишите сообщение…'), 'Привет{Enter}');

    await waitFor(() =>
      expect(calls.find((call) => call.url.endsWith('/chat/chats/1/messages') && call.method === 'POST')?.body).toEqual({ content: 'Привет' }),
    );
  });

  it('refuses a file type that cannot be attached, before uploading anything', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    await screen.findByRole('button', { name: 'Прикрепить файл' });

    await user.upload(fileInput(), new File(['MZ'], 'setup.exe'));

    expect(await screen.findByText(/такой тип файла нельзя прикрепить/)).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith('/attachments'))).toBe(false);
  });

  it('shows the server’s reason when an upload is refused', async () => {
    const user = userEvent.setup();
    uploadStatus = 400;
    uploadMessage = 'Вложения поддерживаются только в чатах с Claude (Sonnet или Opus)';
    renderPage();
    await screen.findByRole('button', { name: 'Прикрепить файл' });

    await user.upload(fileInput(), png());

    expect(await screen.findByText(/только в чатах с Claude/)).toBeTruthy();
    expect(screen.queryByText('error.png')).toBeNull();
  });

  it('takes a file back: the chip goes and the unsent upload is deleted on the server', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Прикрепить файл' });
    await user.upload(fileInput(), png());
    await screen.findByText('error.png');

    // The chip's own close button takes the file back.
    const chip = screen.getByText('error.png').closest('.g-label') as HTMLElement;

    await user.click(chip.querySelector('button') as HTMLElement);

    await waitFor(() => expect(screen.queryByText('error.png')).toBeNull());
    expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/chat/attachments/7'))).toBe(true);
  });
});
