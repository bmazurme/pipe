import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LabPage } from './LabPage';
import { store } from '../store';
import { contextApi, labApi } from '../store/api';

type Sent = { path: string; method: string; body: unknown };
let sent: Sent[];
let projects: unknown[];
let schedules: unknown[];
let runs: unknown[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  projects = [{ id: 1, name: 'Катер', repo: 'me/boat', baseBranch: 'main', tokenHint: 'abcd', checkedAt: null, canWrite: true }];
  schedules = [];
  runs = [];
  store.dispatch(labApi.util.resetApiState());
  store.dispatch(contextApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') {
        sent.push({ path, method: request.method, body: await request.json().catch(() => undefined) });

        return json({ id: 9 });
      }
      if (path === 'lab/projects') return json(projects);
      if (path === 'lab/schedules') return json(schedules);
      if (path === 'lab/runs') return json(runs);

      return json([]);
    }),
  );
  try {
    localStorage.clear();
  } catch {
    // Not available — the page must work without it.
  }
});

const renderPage = (initial = '/lab') =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={[initial]}>
          <LabPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('LabPage', () => {
  it('lists the connected projects with their repository and token hint, never a token', async () => {
    renderPage();

    expect(await screen.findByText('Катер')).toBeInTheDocument();
    expect(screen.getByText(/me\/boat · ветка main · токен …abcd/)).toBeInTheDocument();
    expect(screen.getByText('чтение и запись')).toBeInTheDocument();
    expect(screen.queryByText('скоро')).toBeNull();
  });

  it('connects a project with the repository, branch and token typed in', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Подключить проект/ }));
    const dialog = await screen.findByRole('dialog');

    await user.type(await screen.findByLabelText('Название'), 'Самолёт');
    await user.type(screen.getByLabelText('Репозиторий'), 'me/plane');
    await user.type(screen.getByLabelText('Токен GitHub'), 'github_pat_1234567890');
    await user.click(screen.getByRole('button', { name: 'Подключить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/projects')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/projects')?.body).toMatchObject({ name: 'Самолёт', repo: 'me/plane', token: 'github_pat_1234567890', baseBranch: 'main' });
    expect(dialog).toBeDefined();
  });

  it('makes a schedule whose task is free text, not checkboxes', async () => {
    const user = userEvent.setup();
    renderPage('/lab?tab=schedules');

    await screen.findByText('Катер').catch(() => undefined);
    await waitFor(() => expect(screen.getByRole('button', { name: /Новое расписание/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Новое расписание/ }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('checkbox')).toBeNull();

    await user.type(await screen.findByLabelText('Задача'), 'Обновить зависимости');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/schedules')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/schedules')?.body).toMatchObject({ projectId: 1, task: 'Обновить зависимости', hour: 2, minute: 0 });
  });

  describe('run again', () => {
    const makeRun = (over: Record<string, unknown>) => ({
      id: 1,
      projectId: 1,
      repo: 'me/boat',
      scheduleId: null,
      trigger: 'manual',
      title: 'Задача',
      task: 'Почистить код',
      model: 'opus',
      status: 'failed',
      jobId: null,
      prUrl: null,
      prNumber: null,
      error: null,
      note: null,
      createdAt: new Date().toISOString(),
      ...over,
    });

    it('opens the start dialog prefilled from a failed run and posts the edited task', async () => {
      const user = userEvent.setup();
      runs = [makeRun({})];
      renderPage('/lab?tab=runs');

      await user.click(await screen.findByRole('button', { name: 'Запустить снова' }));
      const task = await screen.findByLabelText('Задача');
      expect(task).toHaveValue('Почистить код');

      await user.type(task, ' аккуратно');
      await user.click(screen.getByRole('button', { name: 'Запустить' }));

      await waitFor(() => expect(sent.find((call) => call.path === 'lab/runs')).toBeDefined());
      expect(sent.find((call) => call.path === 'lab/runs')?.body).toMatchObject({ projectId: 1, task: 'Почистить код аккуратно', model: 'opus' });
    });

    it('is not offered for active runs or runs whose project was disconnected', async () => {
      runs = [makeRun({ id: 1, status: 'queued' }), makeRun({ id: 2, status: 'running' }), makeRun({ id: 3, status: 'publishing' }), makeRun({ id: 4, projectId: null })];
      renderPage('/lab?tab=runs');

      await screen.findAllByText('Задача');
      expect(screen.queryByRole('button', { name: 'Запустить снова' })).toBeNull();
    });
  });

  it('refuses a schedule without a task', async () => {
    const user = userEvent.setup();
    renderPage('/lab?tab=schedules');

    await screen.findByText('Катер').catch(() => undefined);
    await waitFor(() => expect(screen.getByRole('button', { name: /Новое расписание/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Новое расписание/ }));
    await screen.findByRole('dialog');
    await user.click(await screen.findByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Опишите задачу текстом')).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });
});
