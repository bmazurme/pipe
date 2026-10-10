import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import type { ChatType } from '@gravity-ui/aikit';

import { ChatPage } from './ChatPage';
import { store } from '../store';
import { chatApi } from '../store/api';

// AIKit's own history/delete markup isn't what these tests are about, so ChatContainer is
// replaced by plain buttons wired to the same callbacks ChatPage hands it. The dialogs and
// the error Alert are ChatPage's own and render for real.
vi.mock('@gravity-ui/aikit', async () => {
  const { createElement } = await import('react');

  interface StubProps {
    chats: ChatType[];
    onCreateChat?: () => void;
    onSelectChat?: (chat: ChatType) => void;
    onDeleteChat?: (chat: ChatType) => void | Promise<void>;
    headerProps?: { menuItems?: { id: string; label: string; onClick?: () => void }[] };
  }

  return {
    ChatContainer: (props: StubProps) =>
      createElement(
        'div',
        null,
        createElement('button', { type: 'button', onClick: () => props.onCreateChat?.() }, 'Новый чат (stub)'),
        ...props.chats.map((chat) =>
          createElement('button', { key: `select-${chat.id}`, type: 'button', onClick: () => props.onSelectChat?.(chat) }, `Открыть ${chat.name}`),
        ),
        ...props.chats.map((chat) =>
          createElement('button', { key: `delete-${chat.id}`, type: 'button', onClick: () => void props.onDeleteChat?.(chat) }, `Удалить ${chat.name}`),
        ),
        ...(props.headerProps?.menuItems ?? []).map((item) =>
          createElement('button', { key: item.id, type: 'button', onClick: () => item.onClick?.() }, item.label),
        ),
      ),
  };
});

const CHAT = {
  id: 1,
  model: 'gpt',
  title: 'Тестовый чат',
  createdAt: '2026-09-30T09:00:00.000Z',
  updatedAt: '2026-09-30T09:05:00.000Z',
};

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ChatPage />
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function serverError(): Response {
  return jsonResponse({ statusCode: 500, message: 'Internal server error' }, 500);
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled;
}

// Every case answers the chat list with one existing chat; `handle` decides the rest.
function stubFetch(handle: (url: string, method: string) => Response | Promise<Response> | undefined) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const handled = await handle(request.url, request.method);
      if (handled) return handled;
      if (request.url.endsWith('/chat/chats') && request.method === 'GET') return jsonResponse([CHAT]);

      return jsonResponse([]);
    }),
  );
}

beforeEach(() => {
  store.dispatch(chatApi.util.resetApiState());
});

describe('ChatPage — chat management failures', () => {
  it('keeps the create dialog open and shows an error when creating a chat fails', async () => {
    const user = userEvent.setup();
    stubFetch((url, method) => (url.endsWith('/chat/chats') && method === 'POST' ? serverError() : undefined));

    renderPage();
    await user.click(await screen.findByText('Новый чат (stub)'));
    await user.click(await screen.findByRole('button', { name: 'Создать' }));

    expect(await screen.findByText('Не удалось создать чат')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Создать' })).toBeTruthy();
  });

  it('keeps the rename dialog open with the typed title and shows an error when renaming fails', async () => {
    const user = userEvent.setup();
    stubFetch((url, method) => (url.endsWith(`/chat/chats/${CHAT.id}`) && method === 'PATCH' ? serverError() : undefined));

    renderPage();
    await user.click(await screen.findByText(`Открыть ${CHAT.title}`));
    await user.click(await screen.findByText('Переименовать'));

    const renameInput = await screen.findByRole('textbox', { name: 'Название чата' });
    await user.clear(renameInput);
    await user.type(renameInput, 'Новое имя{Enter}');

    expect(await screen.findByText('Не удалось переименовать чат')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Название чата' }) as HTMLInputElement).value).toBe('Новое имя');
  });

  it('shows an error and keeps the chat listed when deleting fails', async () => {
    const user = userEvent.setup();
    stubFetch((url, method) => (url.endsWith(`/chat/chats/${CHAT.id}`) && method === 'DELETE' ? serverError() : undefined));

    renderPage();
    await user.click(await screen.findByText(`Удалить ${CHAT.title}`));

    expect(await screen.findByText('Не удалось удалить чат')).toBeTruthy();
    expect(screen.getByText(`Удалить ${CHAT.title}`)).toBeTruthy();
  });
});

describe('ChatPage — chat dialogs while a request is in flight', () => {
  it('disables «Создать» until the create request finishes', async () => {
    const user = userEvent.setup();
    let finishCreate: (response: Response) => void = () => undefined;
    stubFetch((url, method) =>
      url.endsWith('/chat/chats') && method === 'POST'
        ? new Promise<Response>((resolve) => {
            finishCreate = resolve;
          })
        : undefined,
    );

    renderPage();
    await user.click(await screen.findByText('Новый чат (stub)'));
    await user.click(await screen.findByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(isDisabled(screen.getByRole('button', { name: 'Создать' }))).toBe(true));

    // Once it succeeds the new chat becomes the active one, so its header menu shows up.
    finishCreate(jsonResponse(CHAT));
    expect(await screen.findByText('Переименовать')).toBeTruthy();
  });

  it('disables «Сохранить» until the rename request finishes', async () => {
    const user = userEvent.setup();
    let finishRename: (response: Response) => void = () => undefined;
    stubFetch((url, method) =>
      url.endsWith(`/chat/chats/${CHAT.id}`) && method === 'PATCH'
        ? new Promise<Response>((resolve) => {
            finishRename = resolve;
          })
        : undefined,
    );

    renderPage();
    await user.click(await screen.findByText(`Открыть ${CHAT.title}`));
    await user.click(await screen.findByText('Переименовать'));
    await user.type(await screen.findByRole('textbox', { name: 'Название чата' }), '!');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(isDisabled(screen.getByRole('button', { name: 'Сохранить' }))).toBe(true));

    finishRename(jsonResponse({ ...CHAT, title: `${CHAT.title}!` }));
  });
});

describe('ChatPage — dialog accessible names', () => {
  it('names the new-chat model picker', async () => {
    const user = userEvent.setup();
    stubFetch(() => undefined);

    renderPage();
    await user.click(await screen.findByText('Новый чат (stub)'));

    expect(await screen.findByRole('combobox', { name: 'Модель' })).toBeTruthy();
  });
});
