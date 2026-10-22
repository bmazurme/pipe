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

describe('LabPage: the branch of a run', () => {
  it("prefills the project's branch in the new-run dialog and sends an edited one", async () => {
    const user = userEvent.setup();
    renderPage('/lab?tab=runs');

    await waitFor(() => expect(screen.getByRole('button', { name: /Новый запуск/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Новый запуск/ }));
    await screen.findByRole('dialog');

    const branch = await screen.findByLabelText('Ветка');
    expect(branch).toHaveValue('main');

    await user.clear(branch);
    await user.type(branch, 'release/1.4');
    await user.type(screen.getByLabelText('Задача'), 'Починить тест');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/runs')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/runs')?.body).toMatchObject({ projectId: 1, task: 'Починить тест', baseBranch: 'release/1.4' });
  });
});

describe('LabPage: schedule weekdays', () => {
  const openNewSchedule = async (user: ReturnType<typeof userEvent.setup>) => {
    renderPage('/lab?tab=schedules');
    await waitFor(() => expect(screen.getByRole('button', { name: /Новое расписание/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Новое расписание/ }));
    await screen.findByRole('dialog');
  };

  it('starts with every day on and sends null for them', async () => {
    const user = userEvent.setup();
    await openNewSchedule(user);

    for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) expect(screen.getByRole('button', { name: day })).toHaveAttribute('aria-pressed', 'true');

    await user.type(await screen.findByLabelText('Задача'), 'Обновить зависимости');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/schedules')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/schedules')?.body).toMatchObject({ weekdays: null });
  });

  it('sends only the days left on after toggling the weekend off', async () => {
    const user = userEvent.setup();
    await openNewSchedule(user);

    await user.click(screen.getByRole('button', { name: 'Сб' }));
    await user.click(screen.getByRole('button', { name: 'Вс' }));
    expect(screen.getByRole('button', { name: 'Сб' })).toHaveAttribute('aria-pressed', 'false');

    await user.type(await screen.findByLabelText('Задача'), 'Обновить зависимости');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/schedules')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/schedules')?.body).toMatchObject({ weekdays: [1, 2, 3, 4, 5] });
  });

  it('picks the whole weekend in one click with the preset button', async () => {
    const user = userEvent.setup();
    await openNewSchedule(user);

    await user.click(screen.getByRole('button', { name: 'Выходные' }));

    for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']) expect(screen.getByRole('button', { name: day })).toHaveAttribute('aria-pressed', 'false');
    for (const day of ['Сб', 'Вс']) expect(screen.getByRole('button', { name: day })).toHaveAttribute('aria-pressed', 'true');

    await user.type(await screen.findByLabelText('Задача'), 'Обновить зависимости');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/schedules')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/schedules')?.body).toMatchObject({ weekdays: [6, 7] });
  });

  it('marks a preset selected only while the days exactly match it', async () => {
    const user = userEvent.setup();
    await openNewSchedule(user);

    expect(screen.getByRole('button', { name: 'Каждый день' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Пн' }));
    expect(screen.getByRole('button', { name: 'Каждый день' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Будни' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('refuses a schedule with no day left', async () => {
    const user = userEvent.setup();
    await openNewSchedule(user);

    for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) await user.click(screen.getByRole('button', { name: day }));
    await user.type(await screen.findByLabelText('Задача'), 'Обновить зависимости');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Выберите хотя бы один день недели')).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it('shows the saved days in the row and reloads them into the dialog', async () => {
    const user = userEvent.setup();
    schedules = [
      {
        id: 5,
        projectId: 1,
        name: 'Будни',
        enabled: true,
        hour: 2,
        minute: 0,
        timezone: 'Europe/Moscow',
        weekdays: [1, 2, 3, 4, 5],
        model: 'sonnet',
        task: 'Обновить зависимости',
        contextId: null,
        lastRunAt: null,
        lastResult: null,
      },
    ];
    renderPage('/lab?tab=schedules');

    expect(await screen.findByText(/Пн–Пт в 02:00/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Изменить: Будни' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Пн' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Сб' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Пн' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/schedules/5')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/schedules/5')).toMatchObject({ method: 'PUT', body: { weekdays: [2, 3, 4, 5] } });
  });
});

describe('LabPage: where a run is executed', () => {
  const chooseFusion = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByText('Любой worker'));
    await user.click(await screen.findByText('Fusion 360 на Mac'));
  };

  it('runs on any worker by default and on a Fusion worker when chosen from the list', async () => {
    const user = userEvent.setup();
    renderPage('/lab?tab=runs');

    await waitFor(() => expect(screen.getByRole('button', { name: /Новый запуск/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Новый запуск/ }));
    await screen.findByRole('dialog');
    expect(screen.queryByText(/берёт только worker, у которого/)).toBeNull();

    await chooseFusion(user);
    expect(await screen.findByText(/берёт только worker, у которого/)).toBeTruthy();
    await user.type(screen.getByLabelText('Задача'), 'Построить корпус в Fusion');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/runs')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/runs')?.body).toMatchObject({ executor: 'fusion', task: 'Построить корпус в Fusion' });
  });

  it('sends "any" for an ordinary run', async () => {
    const user = userEvent.setup();
    renderPage('/lab?tab=runs');

    await waitFor(() => expect(screen.getByRole('button', { name: /Новый запуск/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Новый запуск/ }));
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Задача'), 'Починить тест');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/runs')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/runs')?.body).toMatchObject({ executor: 'any' });
  });

  it('puts a Fusion schedule on a Fusion worker and names it in the row', async () => {
    const user = userEvent.setup();
    renderPage('/lab?tab=schedules');

    await waitFor(() => expect(screen.getByRole('button', { name: /Новое расписание/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Новое расписание/ }));
    await screen.findByRole('dialog');
    await chooseFusion(user);
    await user.type(await screen.findByLabelText('Задача'), 'Обновить эскиз');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/schedules')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/schedules')?.body).toMatchObject({ executor: 'fusion' });
  });

  it('shows where a finished run was executed', async () => {
    runs = [
      { id: 5, projectId: 1, repo: 'me/boat', scheduleId: null, trigger: 'manual', title: 'Корпус', task: 'Корпус', model: 'sonnet', executor: 'fusion', status: 'pr_open', jobId: 3, baseBranch: 'main', branch: 'lab/run-5', prNumber: 4, prUrl: 'https://pr/4', note: null, error: null, createdAt: '2026-10-21T10:00:00Z', finishedAt: null },
    ];
    renderPage('/lab?tab=runs');

    expect(await screen.findByText(/Fusion 360/)).toBeTruthy();
  });
});

describe('LabPage: a run that opened a GitHub Issue', () => {
  it('shows the Issue status and a link to it, with no PR link', async () => {
    runs = [
      { id: 6, projectId: 1, repo: 'me/boat', scheduleId: null, trigger: 'manual', title: 'Превышаем лимит API', task: 'Создай Issue: превышаем лимит API', model: 'sonnet', executor: 'any', status: 'issue_open', jobId: 3, baseBranch: 'main', branch: null, prNumber: null, prUrl: null, issueNumber: 42, issueUrl: 'https://github.com/me/boat/issues/42', note: null, error: null, createdAt: '2026-10-21T10:00:00Z', finishedAt: null },
    ];
    renderPage('/lab?tab=runs');

    expect(await screen.findByText('Issue открыт')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Issue #42' })).toHaveAttribute('href', 'https://github.com/me/boat/issues/42');
    expect(screen.queryByRole('link', { name: /^PR #/ })).toBeNull();
  });
});

describe('LabPage: follow-up of a pull request', () => {
  const prRun = (over: Record<string, unknown>) => ({
    id: 5,
    projectId: 1,
    repo: 'me/boat',
    scheduleId: null,
    trigger: 'manual',
    title: 'Задача',
    task: 'Почистить код',
    model: 'opus',
    status: 'pr_open',
    jobId: 3,
    baseBranch: 'main',
    branch: 'lab/run-5-task',
    prUrl: 'https://github.com/me/boat/pull/8',
    prNumber: 8,
    error: null,
    note: null,
    createdAt: new Date().toISOString(),
    ...over,
  });

  it('offers it on an open PR and posts followUpOf with the PR branch', async () => {
    const user = userEvent.setup();
    runs = [prRun({})];
    renderPage('/lab?tab=runs');

    await user.click(await screen.findByRole('button', { name: 'Доработать' }));
    expect(await screen.findByLabelText('Ветка')).toBeDisabled();
    expect(screen.getByLabelText('Задача')).toHaveValue('');

    await user.type(screen.getByLabelText('Задача'), 'Обновить README');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(sent.find((call) => call.path === 'lab/runs')).toBeDefined());
    expect(sent.find((call) => call.path === 'lab/runs')?.body).toMatchObject({
      projectId: 1,
      task: 'Обновить README',
      baseBranch: 'lab/run-5-task',
      followUpOf: 5,
    });
  });

  it('is not offered on runs without an open PR or when the project cannot write', async () => {
    runs = [prRun({ id: 6, status: 'failed' }), prRun({ id: 7, status: 'merged' })];
    renderPage('/lab?tab=runs');

    await screen.findAllByText('Задача');
    expect(screen.queryByRole('button', { name: 'Доработать' })).toBeNull();
  });
});
