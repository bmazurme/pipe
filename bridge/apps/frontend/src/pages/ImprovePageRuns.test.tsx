import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ImprovePage } from './ImprovePage';
import { store } from '../store';
import { improveApi } from '../store/api';

const STATUS = { configured: true, repo: 'o/r', baseBranch: 'main', label: 'loop', models: ['sonnet'] };
const RUN = {
  id: 9,
  userId: 1,
  issueNumber: 12,
  issueTitle: 'Cap read_file output',
  model: 'sonnet',
  trigger: 'manual',
  scheduleId: null,
  status: 'running',
  jobId: 5,
  branch: null,
  prNumber: null,
  prUrl: null,
  note: null,
  error: null,
  createdAt: '2026-10-08T00:00:00Z',
  finishedAt: null,
};

let runsFail: boolean;
let runsList: Array<typeof RUN>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renderRuns() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={['/improve?tab=runs']}>
          <ImprovePage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  runsFail = false;
  runsList = [RUN, { ...RUN, id: 10, issueNumber: 13, issueTitle: 'Second run' }];
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      if (path === 'improve/status') return json(STATUS);
      if (path === 'improve/issues') return json([]);
      if (path === 'improve/runs' && request.method === 'GET') return runsFail ? json({ message: 'Runs exploded' }, 500) : json(runsList);
      if (path === 'improve/runs/9/cancel') return new Promise<Response>(() => {});
      return json({});
    }),
  );
});

describe('ImprovePage runs tab', () => {
  it('shows an error with a retry button instead of a blank tab when the list fails to load', async () => {
    runsFail = true;
    const user = userEvent.setup();
    renderRuns();

    expect(await screen.findByText(/Runs exploded|Не удалось загрузить запуски/)).toBeTruthy();
    expect(screen.queryByText('Запусков ещё не было')).toBeNull();

    runsFail = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText(/Second run/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull());
  });

  it('spins only the stop button of the run being cancelled', async () => {
    const user = userEvent.setup();
    renderRuns();

    await user.click(await screen.findByRole('button', { name: 'Остановить запуск #9' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Остановить запуск #9' }).className).toMatch(/loading/));
    expect(screen.getByRole('button', { name: 'Остановить запуск #10' }).className).not.toMatch(/loading/);
  });
});
