import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { MemoryRouter } from 'react-router-dom';

import { RunsTab } from './RunsTab';
import { store } from '../../store';
import { improveApi } from '../../store/api';

const RUN = {
  id: 7,
  userId: 1,
  kind: 'issue',
  issueNumber: 5,
  issueTitle: 'Задача',
  model: 'sonnet',
  trigger: 'manual',
  scheduleId: null,
  status: 'running',
  jobId: 1,
  branch: null,
  prNumber: null,
  prUrl: null,
  note: null,
  error: null,
  createdAt: new Date().toISOString(),
  finishedAt: null,
};

let calls: string[];
let cancelFails: boolean;
let runs: unknown[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <RunsTab />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  calls = [];
  cancelFails = false;
  runs = [RUN];
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') calls.push(`${request.method} ${path}`);
      if (path === 'improve/runs' && request.method === 'GET') return json(runs);
      if (path === 'worker/jobs/1') return json({ id: 1, model: 'sonnet', status: 'running', logs: '', createdAt: new Date().toISOString() });
      if (path === 'improve/runs/7/continue') return json({ ...RUN, status: 'queued' });
      if (path === 'improve/runs/7/cancel') return cancelFails ? json({ message: 'conflict' }, 409) : json({ ...RUN, status: 'cancelled' });

      return json([]);
    }),
  );
});

describe('improve RunsTab: the router', () => {
  it("shows why 'auto' picked the model, next to the model it picked — and nothing for a model the owner named", async () => {
    runs = [
      { ...RUN, id: 8, model: 'haiku', routing: { model: 'haiku', source: 'classifier', tier: 1, reason: 'Ярус 1 из 4 — haiku' } },
      { ...RUN, id: 9, issueNumber: 6, issueTitle: 'Вторая', model: 'opus' },
    ];
    renderTab();

    expect(await screen.findByText(/Авто: Ярус 1 из 4 — haiku/)).toBeInTheDocument();
    expect(screen.getAllByText(/Авто:/)).toHaveLength(1);
    expect(screen.getByText(/Claude Haiku · вручную/)).toBeInTheDocument();
  });
});

describe('improve RunsTab stop', () => {
  it('asks first and does not call the API until confirmed', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Остановить запуск #7' }));
    expect(await screen.findByText('Остановить запуск #7?')).toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Не останавливать' }));
    expect(calls).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Остановить запуск #7' }));
    await user.click(await screen.findByRole('button', { name: 'Остановить' }));

    await waitFor(() => expect(calls).toEqual(['POST improve/runs/7/cancel']));
  });

  it('shows an error when stopping fails', async () => {
    cancelFails = true;
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Остановить запуск #7' }));
    await user.click(await screen.findByRole('button', { name: 'Остановить' }));

    expect(await screen.findByText(/Не удалось остановить|conflict/)).toBeInTheDocument();
  });
});

describe('improve RunsTab job dialog', () => {
  it("opens the run's worker job in place", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Запуск #1' }));

    expect(await screen.findByText('Задача #1')).toBeInTheDocument();
  });

  it('shows no job button for a run that has no job yet', async () => {
    runs = [{ ...RUN, jobId: null, status: 'preparing' }];
    renderTab();

    await screen.findByText(/Задача/);
    expect(screen.queryByRole('button', { name: /^Запуск #/ })).not.toBeInTheDocument();
  });
});

// A6: a run that waits for the owner's answers to what a cheap model found unclear.
describe('improve RunsTab: a run that waits for answers', () => {
  it('says it waits, offers to answer on the Questions page and to start without answers, and can be stopped', async () => {
    runs = [{ ...RUN, status: 'awaiting_answer', note: 'Ждёт ответов: 2 — страница «Вопросы», карточка improve:5' }];
    renderTab();

    expect(await screen.findByText('Ждёт ответов')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ответить' })).toHaveAttribute('href', '/questions');
    expect(screen.getByRole('button', { name: 'Запустить без ответов запуск #7' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Остановить запуск #7' })).toBeInTheDocument();
  });

  it('starts the run now when «Запустить без ответов» is pressed', async () => {
    const user = userEvent.setup();

    runs = [{ ...RUN, status: 'awaiting_answer' }];
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Запустить без ответов запуск #7' }));

    await waitFor(() => expect(calls).toContain('POST improve/runs/7/continue'));
  });

  it('shows a run being read as active, and offers neither answers nor a start', async () => {
    runs = [{ ...RUN, status: 'clarifying' }];
    renderTab();

    expect(await screen.findByText('Читаем задачу')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Запустить без ответов/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Остановить запуск #7' })).toBeInTheDocument();
  });

  it('offers nothing for a run that is not waiting', async () => {
    renderTab();
    await screen.findByText('Выполняется');

    expect(screen.queryByRole('link', { name: 'Ответить' })).not.toBeInTheDocument();
  });
});

