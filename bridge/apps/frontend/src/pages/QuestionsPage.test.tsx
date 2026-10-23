import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../store';
import { questionsApi } from '../store/api';
import { QuestionsPage } from './QuestionsPage';

const CARD = {
  taskKey: '173:628',
  project: '173',
  questions: [
    { id: 1, text: 'Какую ветку брать за основу?', resolved: false, answer: null, jobId: 41, createdAt: '2026-10-22T10:00:00.000Z' },
    { id: 2, text: 'Нужна ли миграция?', resolved: true, answer: 'Нужна', jobId: null, createdAt: '2026-10-22T10:00:00.000Z' },
  ],
  openCount: 1,
  archived: false,
  updatedAt: '2026-10-22T10:05:00.000Z',
};

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let cards: Record<string, unknown[]>;
let contextUpdated = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  contextUpdated = false;
  cards = { false: [CARD], true: [] };
  store.dispatch(questionsApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      const path = url.pathname.replace('/api/v1/', '');

      if (request.method === 'GET') {
        sent.push({ method: 'GET', path: path + url.search, body: undefined });
        return json(cards[url.searchParams.get('archived') ?? 'false']);
      }

      sent.push({ method: request.method, path, body: await request.json().catch(() => undefined) });
      if (path.endsWith('/context')) return json({ contextId: 5, updated: contextUpdated });

      return json({ id: 1, text: 'x', resolved: true, createdAt: 'x' });
    }),
  );
});

const renderPage = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <QuestionsPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('QuestionsPage', () => {
  it('shows a card tagged with the project number and its questions as checkboxes', async () => {
    renderPage();

    expect(await screen.findByText('Проект 173')).toBeTruthy();
    expect(screen.getByText('173:628')).toBeTruthy();
    expect(screen.getByLabelText('Какую ветку брать за основу?')).not.toBeChecked();
    expect(screen.getByLabelText('Нужна ли миграция?')).toBeChecked();
    expect(screen.getByText(/открыто: 1 из 2/)).toBeTruthy();
  });

  it('ticking a question sends it as resolved', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByLabelText('Какую ветку брать за основу?'));

    await waitFor(() => expect(sent.filter((s) => s.method === 'PATCH')).toEqual([{ method: 'PATCH', path: 'questions/1', body: { resolved: true } }]));
  });

  it('sends an answer for an open question and saves the answers as a Context', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Ответ: Какую ветку брать за основу?'), '  main ');
    await user.click(screen.getByText('Ответить'));

    await waitFor(() => expect(sent.filter((s) => s.method === 'PATCH')).toEqual([{ method: 'PATCH', path: 'questions/1', body: { answer: '  main ' } }]));
    await waitFor(() => expect(screen.getByText('Сохранить ответы как Context').closest('button')).not.toBeDisabled());
    await user.click(screen.getByText('Сохранить ответы как Context'));

    await waitFor(() => expect(sent.some((s) => s.method === 'POST' && s.path === 'questions/cards/173%3A628/context')).toBe(true));
  });

  it('says the Context was updated when it already existed', async () => {
    const user = userEvent.setup();
    contextUpdated = true;
    renderPage();

    await user.type(await screen.findByLabelText('Ответ: Какую ветку брать за основу?'), 'main');
    await user.click(screen.getByText('Ответить'));
    await waitFor(() => expect(sent.some((s) => s.method === 'PATCH')).toBe(true));
    await waitFor(() => expect(screen.getByText('Сохранить ответы как Context').closest('button')).not.toBeDisabled());
    await user.click(screen.getByText('Сохранить ответы как Context'));

    expect(await screen.findByText(/обновлён/)).toBeTruthy();
  });

  it('the archive tab asks for archived cards', async () => {
    const user = userEvent.setup();
    cards.true = [{ ...CARD, questions: CARD.questions.map((q) => ({ ...q, resolved: true })), openCount: 0, archived: true }];
    renderPage();

    await screen.findByText('Проект 173');
    await user.click(screen.getByText('Архив'));

    expect(await screen.findByText(/все закрыты/)).toBeTruthy();
    expect(sent.some((s) => s.path === 'questions?archived=true')).toBe(true);
  });

  it('shows the run a question came from and opens its job dialog', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Запуск #41')).toBeTruthy();
    expect(screen.getAllByText(/Запуск #/)).toHaveLength(1);

    await user.click(screen.getByText('Запуск #41'));

    await waitFor(() => expect(sent.some((s) => s.path.startsWith('worker/jobs/41'))).toBe(true));
  });

  it('shows an empty state when nothing is open', async () => {
    cards.false = [];
    renderPage();

    expect(await screen.findByText('Открытых вопросов нет')).toBeTruthy();
  });
});
