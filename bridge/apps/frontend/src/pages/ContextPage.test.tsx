import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextPage } from './ContextPage';
import { store } from '../store';
import { contextApi } from '../store/api';

const NOTES = { id: 1, name: 'Project notes', content: 'Use pnpm. No default exports.', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' };

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let contexts: unknown[];
let failWith: { status: number; message: string } | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  contexts = [NOTES];
  failWith = null;
  store.dispatch(contextApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);

      if (request.method === 'GET') return json(contexts);

      sent.push({ method: request.method, path, body });
      if (failWith) return json({ message: failWith.message }, failWith.status);

      return request.method === 'DELETE' ? new Response(null, { status: 204 }) : json(NOTES);
    }),
  );
});

const renderPage = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <ContextPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('ContextPage', () => {
  it('lists saved contexts with a preview', async () => {
    renderPage();

    expect(await screen.findByText('Project notes')).toBeTruthy();
    expect(screen.getByText('Use pnpm. No default exports.')).toBeTruthy();
  });

  it('explains the empty state, including that nothing is attached by default', async () => {
    contexts = [];
    renderPage();

    expect(await screen.findByText('Контекстов пока нет')).toBeTruthy();
    expect(screen.getByText(/По умолчанию задача идёт без контекста/)).toBeTruthy();
  });

  it('creates a context from the dialog', async () => {
    const user = userEvent.setup();
    contexts = [];
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Новый контекст/ }));
    await user.type(await screen.findByLabelText('Название контекста'), 'Conventions');
    await user.type(screen.getByLabelText('Текст контекста'), 'Tabs, not spaces.');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'contexts', body: { name: 'Conventions', content: 'Tabs, not spaces.' } }));
  });

  it('keeps the dialog open and says why when the name or text is missing', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Новый контекст/ }));
    await user.click(await screen.findByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Укажите название')).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('shows the server’s duplicate-name refusal', async () => {
    const user = userEvent.setup();
    failWith = { status: 400, message: 'A context named "Project notes" already exists' };
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Новый контекст/ }));
    await user.type(await screen.findByLabelText('Название контекста'), 'Project notes');
    await user.type(screen.getByLabelText('Текст контекста'), 'x');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Контекст с таким названием уже есть')).toBeTruthy();
  });

  it('edits an existing context in place', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Изменить: Project notes' }));
    const text = await screen.findByLabelText('Текст контекста');
    await user.clear(text);
    await user.type(text, 'Use yarn.');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'PATCH', path: 'contexts/1', body: { name: 'Project notes', content: 'Use yarn.' } }));
  });

  it('asks before deleting, and says running jobs are unaffected', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Удалить: Project notes' }));
    expect(await screen.findByText(/у них своя копия/)).toBeTruthy();
    expect(sent).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'DELETE', path: 'contexts/1', body: undefined }));
  });
});
