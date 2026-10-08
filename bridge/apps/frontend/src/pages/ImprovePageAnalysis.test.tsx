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
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);

      if (request.method !== 'GET') sent.push({ method: request.method, path, body });
      if (path === 'improve/status') return json(STATUS);
      if (path === 'improve/runs' && request.method === 'GET') return json([ANALYSIS_RUN]);
      if (path === 'improve/schedules' && request.method === 'GET') return json([]);
      if (path === 'improve/settings' && request.method === 'GET') return json({ autoStartModel: null });

      return json(ANALYSIS_RUN);
    }),
  );
});

describe('ImprovePage analysis', () => {
  it('starts an analysis for the chosen directions', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=analysis');

    await user.click(await screen.findByLabelText('UI/UX'));
    await user.click(screen.getByRole('button', { name: 'Запустить анализ' }));

    await waitFor(() =>
      expect(sent).toContainEqual({
        method: 'POST',
        path: 'improve/analysis',
        body: { model: 'sonnet', categories: ['general', 'security', 'performance', 'reliability'], autoCreate: false },
      }),
    );
  });

  it('shows proposals and files them as issues', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=analysis');

    expect(await screen.findByText(/Add rate limit/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Создать issues' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'improve/runs/20/create-issues', body: {} }));
  });

  it('saves an analysis schedule with its directions', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=schedules');

    await user.click(await screen.findByRole('button', { name: 'Новое расписание' }));
    await user.click(await screen.findByText('Задачи из issues'));
    await user.click(await screen.findByText('Анализ (по 1 задаче на направление)'));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(sent).toContainEqual({
        method: 'POST',
        path: 'improve/schedules',
        body: expect.objectContaining({ kind: 'analysis', categories: ['general', 'uiux', 'security', 'performance', 'reliability'], autoCreateIssues: true }),
      }),
    );
  });
});
