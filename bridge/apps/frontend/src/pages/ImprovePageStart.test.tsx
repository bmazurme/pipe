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
type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let requested: string[];

const ANALYSIS_RUN = {
  id: 20,
  userId: 1,
  kind: 'analysis',
  issueNumber: null,
  issueTitle: 'Анализ: Безопасность',
  model: 'sonnet',
  trigger: 'manual',
  scheduleId: null,
  status: 'analyzed',
  jobId: 5,
  branch: null,
  prNumber: null,
  prUrl: null,
  note: '1 предложений ждут проверки',
  error: null,
  result: JSON.stringify({ categories: ['security'], autoCreate: false, items: [{ category: 'security', title: 'Add rate limit', risk: 'low', body: 'x' }] }),
  createdAt: '2026-10-08T00:00:00Z',
  finishedAt: null,
};

const ISSUES = [12, 13, 14].map((number) => ({
  number,
  title: `Task ${number}`,
  body: '',
  htmlUrl: 'u',
  createdAt: `2026-10-0${number - 11}T00:00:00Z`,
  labels: ['loop'],
  run: null,
}));

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function renderPage(path: string) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={[path]}>
          <ImprovePage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  sent = [];
  requested = [];
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);

      if (request.method !== 'GET') sent.push({ method: request.method, path, body });
      if (path === 'improve/status') return json(STATUS);
      if (path === 'improve/issues') {
        requested.push(new URL(request.url).search);

        return json(ISSUES);
      }
      if (path === 'improve/runs' && request.method === 'GET') return json([ANALYSIS_RUN]);
      if (path === 'improve/schedules' && request.method === 'GET') return json([]);
      if (path === 'improve/settings' && request.method === 'GET') return json({ autoStartModel: null });

      return json(ANALYSIS_RUN);
    }),
  );
});

describe('ImprovePage start issues', () => {
  it('starts the selected issues in one request', async () => {
    const user = userEvent.setup();
    renderPage('/improve');

    await user.click(await screen.findByLabelText('Выбрать #12'));
    await user.click(screen.getByLabelText('Выбрать #14'));
    await user.click(screen.getByRole('button', { name: 'Запустить выбранные (2)' }));

    await waitFor(() =>
      expect(sent).toContainEqual({ method: 'POST', path: 'improve/runs/batch', body: { issueNumbers: [12, 14], model: 'sonnet' } }),
    );
  });

  it('starts the oldest issues', async () => {
    const user = userEvent.setup();
    renderPage('/improve');

    await user.click(await screen.findByRole('button', { name: 'Запустить 3 старых' }));

    await waitFor(() =>
      expect(sent).toContainEqual({ method: 'POST', path: 'improve/runs/batch', body: { issueNumbers: [12, 13, 14], model: 'sonnet' } }),
    );
  });

  it('takes analysis proposals into work', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=analysis');

    await user.click(await screen.findByRole('button', { name: 'В работу' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'improve/runs/20/start-items', body: { model: 'sonnet' } }));
  });

  it('can start an analysis that takes its issues straight into work', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=analysis');

    await user.click(await screen.findByText('И сразу взять в работу'));
    await user.click(screen.getByRole('button', { name: 'Запустить анализ' }));

    await waitFor(() =>
      expect(sent).toContainEqual({
        method: 'POST',
        path: 'improve/analysis',
        body: expect.objectContaining({ autoCreate: true, autoStart: true }),
      }),
    );
  });

  it('can list every open issue, not just the labelled ones', async () => {
    const user = userEvent.setup();
    renderPage('/improve');

    await screen.findByLabelText('Выбрать #12');
    expect(requested).toEqual(['']);

    await user.click(screen.getByText('Все открытые issues'));

    await waitFor(() => expect(requested).toContain('?all=1'));
  });
});
