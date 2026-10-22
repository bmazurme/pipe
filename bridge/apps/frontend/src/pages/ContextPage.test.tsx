import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextPage } from './ContextPage';
import { store } from '../store';
import { contextApi, MAX_CONTEXT_NAME_LENGTH } from '../store/api';

const NOTES = { id: 1, name: 'Project notes', content: 'Use pnpm. No default exports.', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' };
// What GET /contexts returns: a summary, never the text.
const SUMMARY = { id: 1, name: 'Project notes', contentLength: 29, createdAt: NOTES.createdAt, updatedAt: NOTES.updatedAt, schedules: [], lastUsedAt: null };
let requested: string[];

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let contexts: unknown[];
let failWith: { status: number; message: string } | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  contexts = [SUMMARY];
  requested = [];
  failWith = null;
  store.dispatch(contextApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);

      if (request.method === 'GET') {
        requested.push(path);

        return json(path === 'contexts/1' ? NOTES : contexts);
      }

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
  it('lists saved contexts with their size, without loading any text', async () => {
    renderPage();

    expect(await screen.findByText('Project notes')).toBeTruthy();
    expect(screen.getByText(/29 симв\./)).toBeTruthy();
    expect(screen.queryByText('Use pnpm. No default exports.')).toBeNull();
    expect(requested).toEqual(['contexts']);
  });

  it('shows no size for a context saved before it was recorded', async () => {
    contexts = [{ ...SUMMARY, contentLength: null }];
    renderPage();

    expect(await screen.findByText('Project notes')).toBeTruthy();
    expect(screen.queryByText(/симв\./)).toBeNull();
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
    // The text was fetched for this one context, when it was opened.
    expect(requested).toContain('contexts/1');
    expect((text as HTMLTextAreaElement).value).toBe('Use pnpm. No default exports.');
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

describe('ContextDialog file upload', () => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Новый контекст/ }));
    await screen.findByLabelText('Название контекста');
  };
  const pick = (file: File) =>
    userEvent.upload(screen.getByLabelText('Файл с текстом контекста') as HTMLInputElement, file, { applyAccept: false });
  const textValue = () => (screen.getByLabelText('Текст контекста') as HTMLTextAreaElement).value;

  it('fills the name and text from a small .md file and saves them', async () => {
    const user = userEvent.setup();
    await openDialog(user);
    expect(screen.getByRole('button', { name: 'Загрузить из файла' })).toBeTruthy();

    await pick(new File(['# Rules\nUse pnpm.'], 'CLAUDE.md', { type: 'text/markdown' }));

    await waitFor(() => expect(textValue()).toBe('# Rules\nUse pnpm.'));
    expect((screen.getByLabelText('Название контекста') as HTMLInputElement).value).toBe('CLAUDE');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'contexts', body: { name: 'CLAUDE', content: '# Rules\nUse pnpm.' } }));
  });

  it('keeps a name that was already typed', async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await user.type(screen.getByLabelText('Название контекста'), 'Mine');

    await pick(new File(['text'], 'README.md'));

    await waitFor(() => expect(textValue()).toBe('text'));
    expect((screen.getByLabelText('Название контекста') as HTMLInputElement).value).toBe('Mine');
  });

  it('truncates an oversize file with a warning and still saves', async () => {
    const user = userEvent.setup();
    await openDialog(user);

    await pick(new File(['a'.repeat(20_050)], 'big.txt'));

    expect(await screen.findByText(/Файл обрезан до/)).toBeTruthy();
    expect(textValue()).toHaveLength(20_000);
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it('warns about secret-looking text without blocking the save', async () => {
    const user = userEvent.setup();
    await openDialog(user);

    await pick(new File(['contact: someone@example.com\n'], 'notes.md'));

    expect(await screen.findByText(/найдено похожее на секреты/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it('warns about a token typed into the text without any file', async () => {
    const user = userEvent.setup();
    await openDialog(user);

    await user.click(screen.getByLabelText('Текст контекста'));
    await user.paste('token ghp_abcdefghijklmnopqrstuvwxyz0123456789');

    expect(await screen.findByText(/найдено похожее на секреты/)).toBeTruthy();
  });

  it('clears the warning once the secret is removed from the text', async () => {
    const user = userEvent.setup();
    await openDialog(user);

    await pick(new File(['contact: someone@example.com\n'], 'notes.md'));
    expect(await screen.findByText(/найдено похожее на секреты/)).toBeTruthy();

    await user.clear(screen.getByLabelText('Текст контекста'));

    await waitFor(() => expect(screen.queryByText(/найдено похожее на секреты/)).toBeNull());
  });

  it('refuses a non-text file', async () => {
    const user = userEvent.setup();
    await openDialog(user);

    await pick(new File(['x'], 'image.png', { type: 'image/png' }));

    expect(await screen.findByText(/не текстовый/)).toBeTruthy();
    expect(textValue()).toBe('');
    expect(sent).toEqual([]);
  });
});

describe('ContextPage usage info', () => {
  it('says a context is unused when no schedule or job refers to it', async () => {
    renderPage();

    expect(await screen.findByText(/в расписаниях: 0/)).toBeTruthy();
    expect(screen.getByText(/не использовался/)).toBeTruthy();
  });

  it('shows the schedule count and last run, and names the schedules in the delete dialog', async () => {
    const user = userEvent.setup();
    contexts = [{ ...SUMMARY, schedules: [{ id: 3, name: 'Nightly' }, { id: 4, name: 'Weekly' }], lastUsedAt: new Date().toISOString() }];
    renderPage();

    expect(await screen.findByText(/в расписаниях: 2/)).toBeTruthy();
    expect(screen.queryByText(/не использовался/)).toBeNull();
    expect(screen.getByText(/запускался/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Удалить: Project notes' }));
    expect(await screen.findByText(/Расписания Improve продолжат работу без контекста: Nightly, Weekly/)).toBeTruthy();
  });
});

describe('ContextDialog closing and saving', () => {
  it('closes at once when nothing was typed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Новый контекст/ }));
    await user.click(await screen.findByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByLabelText('Название контекста')).toBeNull());
    expect(screen.queryByText('Закрыть без сохранения?')).toBeNull();
  });

  it('asks before throwing away typed text, and keeps it when told to go on editing', { timeout: 30000 }, async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Новый контекст/ }));
    await user.type(await screen.findByLabelText('Текст контекста'), 'черновик');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    // The confirmation is a dialog nested in a dialog: under a loaded CI runner
    // floating-ui can leave it marked aria-hidden for a while, so its buttons are
    // looked up including hidden ones — they are rendered and clickable either way.
    expect(await screen.findByText('Закрыть без сохранения?', {}, { timeout: 5000 })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Продолжить редактирование', hidden: true }, { timeout: 5000 }));

    await waitFor(() => expect(screen.queryByText('Закрыть без сохранения?')).toBeNull());
    expect((screen.getByLabelText('Текст контекста') as HTMLTextAreaElement).value).toBe('черновик');

    await user.click(await screen.findByRole('button', { name: 'Отмена' }));
    await user.click(await screen.findByRole('button', { name: 'Закрыть без сохранения', hidden: true }, { timeout: 5000 }));

    await waitFor(() => expect(screen.queryByLabelText('Текст контекста')).toBeNull());
    expect(sent).toEqual([]);
  });

  it('does not ask about an existing context that was opened and not changed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Изменить: Project notes' }));
    await screen.findByLabelText('Текст контекста');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByLabelText('Текст контекста')).toBeNull());
  });

  it('saves with Ctrl+Enter from the text field', async () => {
    const user = userEvent.setup();
    contexts = [];
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Новый контекст/ }));
    await user.type(await screen.findByLabelText('Название контекста'), 'Quick');
    await user.type(screen.getByLabelText('Текст контекста'), 'Notes.');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'contexts', body: { name: 'Quick', content: 'Notes.' } }));
  });
});

describe('ContextPage duplicate', () => {
  it('opens a new-context dialog prefilled from the source, and saving creates a copy', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Дублировать: Project notes' }));
    const name = (await screen.findByLabelText('Название контекста')) as HTMLInputElement;
    expect(requested).toContain('contexts/1');
    expect(screen.getAllByText('Новый контекст').length).toBeGreaterThan(0);
    expect(name.value).toBe('Project notes (копия)');
    expect((screen.getByLabelText('Текст контекста') as HTMLTextAreaElement).value).toBe(NOTES.content);

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent).toEqual([{ method: 'POST', path: 'contexts', body: { name: 'Project notes (копия)', content: NOTES.content } }]));
    // The source is never touched.
    expect(sent.some((request) => request.method === 'PATCH' || request.path === 'contexts/1')).toBe(false);
  });

  it('cuts a long source name so the copy still fits the name limit', async () => {
    const user = userEvent.setup();
    const longName = 'n'.repeat(MAX_CONTEXT_NAME_LENGTH);
    contexts = [{ ...SUMMARY, name: longName }];
    const respond = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (request) =>
      new URL((request as Request).url).pathname.endsWith('/contexts/1') ? json({ ...NOTES, name: longName }) : respond(request),
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: `Дублировать: ${longName}` }));
    const name = (await screen.findByLabelText('Название контекста')) as HTMLInputElement;

    expect(name.value).toHaveLength(MAX_CONTEXT_NAME_LENGTH);
    expect(name.value.endsWith(' (копия)')).toBe(true);
  });

  it('closes the untouched copy at once, without asking', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Дублировать: Project notes' }));
    await screen.findByLabelText('Текст контекста');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByLabelText('Текст контекста')).toBeNull());
    expect(screen.queryByText('Закрыть без сохранения?')).toBeNull();
    expect(sent).toEqual([]);
  });
});
