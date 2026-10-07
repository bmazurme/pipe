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
const ISSUES = [
  { number: 12, title: 'Cap read_file output', body: '', htmlUrl: 'u', createdAt: '2026-10-01T00:00:00Z', labels: ['loop'], run: null },
  {
    number: 13,
    title: 'Already has a PR',
    body: '',
    htmlUrl: 'u',
    createdAt: '2026-10-02T00:00:00Z',
    labels: ['loop'],
    run: { id: 4, status: 'pr_open', prNumber: 77, prUrl: 'https://gh/77', note: null, error: null },
  },
];
const RUN = {
  id: 9,
  userId: 1,
  issueNumber: 12,
  issueTitle: 'Cap read_file output',
  model: 'sonnet',
  trigger: 'schedule',
  scheduleId: 1,
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
const SCHEDULE = {
  id: 1,
  name: 'Ночной запуск',
  enabled: true,
  hour: 2,
  minute: 0,
  timezone: 'Europe/Moscow',
  count: 5,
  model: 'sonnet',
  label: 'loop',
  lastRunAt: null,
  lastResult: null,
};

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let status: typeof STATUS | (Omit<typeof STATUS, 'configured' | 'repo'> & { configured: boolean; repo: string | null }) = STATUS;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function renderPage(path = '/improve') {
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
  status = STATUS;
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);

      if (request.method !== 'GET') sent.push({ method: request.method, path, body });
      if (path === 'improve/status') return json(status);
      if (path === 'improve/issues') return json(ISSUES);
      if (path === 'improve/runs' && request.method === 'GET') return json([RUN]);
      if (path === 'improve/schedules' && request.method === 'GET') return json([SCHEDULE]);
      if (path === 'improve/settings' && request.method === 'GET') return json({ autoStartModel: null });

      return json({ ...RUN, status: 'queued', started: [12], skipped: [] });
    }),
  );
});

describe('ImprovePage', () => {
  it('lists the open loop issues and starts one with the chosen model', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/#12 Cap read_file output/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Запустить #12' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'improve/runs', body: { issueNumber: 12, model: 'sonnet' } }));
  });

  it('will not start an issue that already has an open PR, and links to it', async () => {
    renderPage();

    await screen.findByText(/#13 Already has a PR/);

    expect(screen.getByRole('button', { name: 'Запустить #13' })).toBeDisabled();
    expect(screen.getByLabelText('PR #77').getAttribute('href')).toBe('https://gh/77');
    expect(screen.getByText('PR открыт')).toBeTruthy();
  });

  it('explains what is missing when GitHub is not configured', async () => {
    status = { ...STATUS, configured: false, repo: null };
    renderPage();

    expect(await screen.findByText('GitHub не настроен')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Запустить #/ })).toBeNull();
  });

  it('shows runs with their trigger and lets a working one be stopped', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=runs');

    expect(await screen.findByText(/по расписанию/)).toBeTruthy();
    expect(screen.getByText('Выполняется')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Остановить запуск #9' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'improve/runs/9/cancel', body: undefined }));
  });

  it('describes existing schedules and creates a new one from the form', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=schedules');

    expect(await screen.findByText('каждый день в 02:00 (Europe/Moscow) · 5 задач · Claude Sonnet')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Новое расписание' }));
    const count = await screen.findByLabelText('Количество задач');
    await user.clear(count);
    await user.type(count, '3');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(sent).toContainEqual({
        method: 'POST',
        path: 'improve/schedules',
        body: { name: 'Ночной запуск', enabled: true, hour: 2, minute: 0, timezone: 'Europe/Moscow', count: 3, model: 'sonnet' },
      }),
    );
  });

  it('keeps the form open with the problem when it is invalid', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=schedules');

    await user.click(await screen.findByRole('button', { name: 'Новое расписание' }));
    const count = await screen.findByLabelText('Количество задач');
    await user.clear(count);
    await user.type(count, '99');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Количество задач — от 1 до 20')).toBeTruthy();
    expect(sent.filter((call) => call.path === 'improve/schedules')).toEqual([]);
  });

  it('runs a schedule right now and deletes one', async () => {
    const user = userEvent.setup();
    renderPage('/improve?tab=schedules');

    await user.click(await screen.findByRole('button', { name: 'Запустить сейчас: Ночной запуск' }));
    expect(await screen.findByText(/Запущено: #12/)).toBeTruthy();
    expect(sent).toContainEqual({ method: 'POST', path: 'improve/schedules/1/run', body: undefined });

    await user.click(screen.getByRole('button', { name: 'Удалить: Ночной запуск' }));
    await waitFor(() => expect(sent).toContainEqual({ method: 'DELETE', path: 'improve/schedules/1', body: undefined }));
  });
});
