import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { RunsTab } from './RunsTab';
import { store } from '../../store';
import { labApi } from '../../store/api';

const RUN = {
  id: 7,
  projectId: 1,
  repo: 'o/r',
  scheduleId: null,
  trigger: 'manual',
  title: 'Задача',
  task: 'Сделать',
  model: 'sonnet',
  executor: 'any',
  status: 'running',
  jobId: 1,
  baseBranch: null,
  branch: null,
  prNumber: null,
  prUrl: null,
  issueNumber: null,
  issueUrl: null,
  note: null,
  error: null,
  createdAt: new Date().toISOString(),
  finishedAt: null,
};

let calls: string[];
let gets: string[];
let cancelFails: boolean;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RunsTab />
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  calls = [];
  gets = [];
  cancelFails = false;
  store.dispatch(labApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method === 'GET') gets.push(path);
      if (request.method !== 'GET') calls.push(`${request.method} ${path}`);
      if (path === 'lab/runs' && request.method === 'GET') return json([RUN]);
      if (path === 'lab/runs/7/cancel') return cancelFails ? json({ message: 'conflict' }, 409) : json({ ...RUN, status: 'cancelled' });

      if (path === 'worker/jobs/1') return json({ id: 1, model: 'sonnet', status: 'running', logs: '', createdAt: new Date().toISOString() });

      return json([]);
    }),
  );
});

describe('lab RunsTab stop', () => {
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

    await waitFor(() => expect(calls).toEqual(['POST lab/runs/7/cancel']));
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

describe('lab RunsTab job dialog', () => {
  it('opens the run\'s worker job in place', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Запуск #1' }));

    expect(await screen.findByText('Задача #1')).toBeInTheDocument();
    await waitFor(() => expect(gets.some((path) => path.startsWith('worker/jobs/1'))).toBe(true));
  });
});
