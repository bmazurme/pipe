import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ChatPage } from './ChatPage';
import { store } from '../store';
import { chatApi } from '../store/api';

const CHAT = {
  id: 1,
  model: 'gpt',
  title: 'Тестовый чат',
  createdAt: '2026-09-30T09:00:00.000Z',
  updatedAt: '2026-09-30T09:05:00.000Z',
};

const MESSAGES = [
  {
    id: 10,
    chatId: 1,
    role: 'user',
    content: 'Привет',
    status: 'complete',
    errorMessage: null,
    createdAt: '2026-09-30T09:00:00.000Z',
    updatedAt: '2026-09-30T09:00:00.000Z',
  },
  {
    id: 11,
    chatId: 1,
    role: 'assistant',
    content: 'Здравствуйте!',
    status: 'complete',
    errorMessage: null,
    createdAt: '2026-09-30T09:00:05.000Z',
    updatedAt: '2026-09-30T09:00:05.000Z',
  },
];

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ChatPage />
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function input(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Напишите сообщение…');
}

beforeEach(() => {
  store.dispatch(chatApi.util.resetApiState());
});

describe('ChatPage', () => {
  it('renders the page header and an empty composer with no chats yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));

    renderPage();

    expect(await screen.findByText('Chat')).toBeTruthy();
    expect(input()).toBeTruthy();
  });

  it('creates a chat implicitly when sending from the empty composer', async () => {
    const user = userEvent.setup();
    let createBody: unknown;
    let sendBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.endsWith('/chat/chats') && method === 'GET') return jsonResponse([]);
        if (url.endsWith('/chat/chats') && method === 'POST') {
          createBody = JSON.parse(await request.clone().text());
          return jsonResponse(CHAT);
        }
        if (url.includes(`/chat/chats/${CHAT.id}/messages`) && method === 'GET') return jsonResponse(MESSAGES);
        if (url.includes(`/chat/chats/${CHAT.id}/messages`) && method === 'POST') {
          sendBody = JSON.parse(await request.clone().text());
          return jsonResponse({ userMessage: MESSAGES[0], assistantMessage: MESSAGES[1] });
        }

        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Chat');

    await user.type(input(), 'Привет{Enter}');

    await waitFor(() => expect(createBody).toEqual({ model: 'sonnet' }));
    await waitFor(() => expect(sendBody).toEqual({ content: 'Привет' }));

    // Once the chat exists and its messages are fetched (invalidated by
    // sendMessage), both the sent message and the (mocked) reply render.
    expect(await screen.findByText('Привет')).toBeTruthy();
    expect(await screen.findByText('Здравствуйте!')).toBeTruthy();
  });

  it('lets the model be picked from the composer before any chat exists, and uses it for the implicit create', async () => {
    const user = userEvent.setup();
    let createBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.endsWith('/chat/chats') && method === 'GET') return jsonResponse([]);
        if (url.endsWith('/chat/chats') && method === 'POST') {
          createBody = JSON.parse(await request.clone().text());
          return jsonResponse({ ...CHAT, model: 'gpt' });
        }
        if (url.includes(`/chat/chats/${CHAT.id}/messages`)) return jsonResponse(MESSAGES);

        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Chat');

    expect(screen.getByText('Модель:')).toBeTruthy();

    await user.click(screen.getByText('Claude Sonnet'));
    await user.click(await screen.findByText('GPT'));

    await user.type(input(), 'Привет{Enter}');

    await waitFor(() => expect(createBody).toEqual({ model: 'gpt' }));
  });

  it('hides the composer model picker once a chat is active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.endsWith('/chat/chats') && method === 'GET') return jsonResponse([CHAT]);
        if (url.includes(`/chat/chats/${CHAT.id}/messages`) && method === 'GET') return jsonResponse(MESSAGES);

        return jsonResponse([]);
      }),
    );

    renderPage();

    const historyButtonEl = document.querySelector('[data-qa="header-action-history"]');
    if (!historyButtonEl) throw new Error('history button not found');
    const user = userEvent.setup();
    await user.click(historyButtonEl);
    await user.click(await screen.findByText(CHAT.title));

    await screen.findByText('Привет');
    expect(screen.queryByText('Модель:')).toBeNull();
  });

  it('renders a failed assistant turn inline instead of leaving it blank', async () => {
    const user = userEvent.setup();
    const failedMessages = [
      MESSAGES[0],
      { ...MESSAGES[1], content: '', status: 'failed', errorMessage: 'Модель недоступна' },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.endsWith('/chat/chats') && method === 'GET') return jsonResponse([]);
        if (url.endsWith('/chat/chats') && method === 'POST') return jsonResponse(CHAT);
        if (url.includes(`/chat/chats/${CHAT.id}/messages`) && method === 'GET') return jsonResponse(failedMessages);
        if (url.includes(`/chat/chats/${CHAT.id}/messages`) && method === 'POST') {
          return jsonResponse({ userMessage: failedMessages[0], assistantMessage: failedMessages[1] });
        }

        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Chat');
    await user.type(input(), 'ping{Enter}');

    expect(await screen.findByText(/Модель недоступна/)).toBeTruthy();
  });
});

describe('ChatPage — renaming a chat', () => {
  it('renames the active chat via the header menu', async () => {
    const user = userEvent.setup();
    let renameBody: unknown;
    let renamedTitle = CHAT.title;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.endsWith('/chat/chats') && method === 'GET') {
          return jsonResponse([{ ...CHAT, title: renamedTitle }]);
        }
        if (url.endsWith(`/chat/chats/${CHAT.id}`) && method === 'PATCH') {
          renameBody = JSON.parse(await request.clone().text());
          renamedTitle = (renameBody as { title: string }).title;
          return jsonResponse({ ...CHAT, title: renamedTitle });
        }
        if (url.includes(`/chat/chats/${CHAT.id}/messages`) && method === 'GET') return jsonResponse(MESSAGES);

        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Chat');

    // Select the only existing chat so it becomes the active one.
    const historyButton = document.querySelector('[data-qa="header-action-history"]');
    if (!historyButton) throw new Error('history button not found');
    await user.click(historyButton);
    await user.click(await screen.findByText(CHAT.title));

    await screen.findByText('Привет');

    const menuButton = document.querySelector('[data-qa="header-menu-button"]');
    if (!menuButton) throw new Error('header menu button not found');
    await user.click(menuButton);
    await user.click(await screen.findByText('Переименовать'));

    const renameInput = await screen.findByDisplayValue(CHAT.title);
    await user.clear(renameInput);
    await user.type(renameInput, 'Новое имя{Enter}');

    await waitFor(() => expect(renameBody).toEqual({ title: 'Новое имя' }));
    expect(await screen.findByText('Новое имя')).toBeTruthy();
  });
});

describe('ChatPage — opening an existing chat from history', () => {
  it('renders an existing chat\'s already-complete messages after selecting it from history', async () => {
    const user = userEvent.setup();
    const existingChats = [
      { ...CHAT, id: 1, title: null },
      { ...CHAT, id: 2, title: null },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.endsWith('/chat/chats') && method === 'GET') return jsonResponse(existingChats);
        if (url.includes('/chat/chats/1/messages') && method === 'GET') return jsonResponse(MESSAGES);
        if (url.includes('/chat/chats/2/messages') && method === 'GET') return jsonResponse([]);

        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Chat');

    const historyButton = document.querySelector('[data-qa="header-action-history"]');
    if (!historyButton) throw new Error('history button not found');
    await user.click(historyButton);
    await user.click(await screen.findByText(`GPT · #1`));

    expect(await screen.findByText('Привет')).toBeTruthy();
    expect(await screen.findByText('Здравствуйте!')).toBeTruthy();
  });
});
