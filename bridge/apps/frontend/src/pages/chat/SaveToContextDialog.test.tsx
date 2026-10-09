import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { contextApi } from '../../store/api';
import type { ContextDraft } from './chatContext';
import { SaveToContextDialog } from './SaveToContextDialog';

const DRAFT: ContextDraft = { name: 'Разбор ошибки', content: '**Пользователь:** Почему падает?\n\n**Claude:** Из-за типа.', truncated: false, messages: 2 };

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let failWith: { status: number; message: string } | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  failWith = null;
  store.dispatch(contextApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      sent.push({ method: request.method, path, body: request.method === 'GET' ? undefined : await request.json().catch(() => undefined) });

      return failWith ? json({ message: failWith.message }, failWith.status) : json({ id: 1, name: DRAFT.name, content: DRAFT.content, createdAt: 'x', updatedAt: 'x' });
    }),
  );
});

const renderDialog = (draft = DRAFT, onClose = vi.fn()) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <SaveToContextDialog draft={draft} onClose={onClose} />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('SaveToContextDialog', () => {
  it('is prefilled with the chat and saves it as a context', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect((screen.getByLabelText('Название контекста') as HTMLInputElement).value).toBe('Разбор ошибки');
    expect((screen.getByLabelText('Текст контекста') as HTMLTextAreaElement).value).toBe(DRAFT.content);

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'contexts', body: { name: 'Разбор ошибки', content: DRAFT.content } }));
    expect(await screen.findByText(/сохранён\. Выберите его в форме/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть Context' }).getAttribute('href')).toBe('/context');
  });

  it('saves what was edited, not the original', async () => {
    const user = userEvent.setup();
    renderDialog();

    const text = screen.getByLabelText('Текст контекста');
    await user.clear(text);
    await user.type(text, 'Только вывод.');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.method === 'POST')?.body).toMatchObject({ content: 'Только вывод.' }));
  });

  it('warns that a long chat was cut to its end', () => {
    renderDialog({ ...DRAFT, truncated: true });

    expect(screen.getByText(/сохранён его конец, начало опущено/)).toBeTruthy();
  });

  it('will not save an empty name or text, and sends nothing', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByLabelText('Название контекста'));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Укажите название')).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('shows the duplicate-name refusal and stays open to rename', async () => {
    const user = userEvent.setup();
    failWith = { status: 400, message: 'A context named "Разбор ошибки" already exists' };
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Контекст с таким названием уже есть')).toBeTruthy();
    expect(screen.getByLabelText('Название контекста')).toBeTruthy();
  });
});
