import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

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
  cancelFails = false;
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') calls.push(`${request.method} ${path}`);
      if (path === 'improve/runs' && request.method === 'GET') return json([RUN]);
      if (path === 'improve/runs/7/cancel') return cancelFails ? json({ message: 'conflict' }, 409) : json({ ...RUN, status: 'cancelled' });

      return json([]);
    }),
  );
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
