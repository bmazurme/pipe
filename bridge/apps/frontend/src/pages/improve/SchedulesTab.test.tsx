import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { SchedulesTab } from './SchedulesTab';
import { store } from '../../store';
import { improveApi } from '../../store/api';

const makeSchedule = (id: number, name: string) => ({
  id,
  name,
  enabled: true,
  hour: 2,
  minute: 0,
  timezone: 'Europe/Moscow',
  count: 5,
  model: 'sonnet',
  label: 'loop',
  kind: 'issues',
  categories: null,
  autoCreateIssues: true,
  autoStartIssues: false,
  contextId: null as number | null,
  lastRunAt: null,
  lastResult: null,
});

const CONTEXTS = [
  { id: 3, name: 'Договорённости', createdAt: 'x', updatedAt: 'x' },
  { id: 4, name: 'Что уже пробовали', createdAt: 'x', updatedAt: 'x' },
];
const makeAnalysis = (id: number, name: string, contextId: number | null) => ({
  ...makeSchedule(id, name),
  kind: 'analysis',
  categories: null,
  contextId,
});

let schedules: unknown[];
let sent: { method: string; path: string; body: unknown }[];

let calls: string[];
let listFails: boolean;
let deleteFails: boolean;
let saveFails: boolean;
let releaseRun: () => void;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <SchedulesTab />
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  calls = [];
  sent = [];
  schedules = [makeSchedule(1, 'Первое'), makeSchedule(2, 'Второе')];
  listFails = false;
  deleteFails = false;
  saveFails = false;
  releaseRun = () => undefined;
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') {
        calls.push(`${request.method} ${path}`);
        const text = await request.clone().text();

        sent.push({ method: request.method, path, body: text ? JSON.parse(text) : undefined });
      }
      if (path === 'contexts' && request.method === 'GET') return json(CONTEXTS);
      if (path === 'improve/schedules' && request.method === 'GET') {
        return listFails ? json({ message: 'boom' }, 500) : json(schedules);
      }
      if (path === 'improve/settings') return json({ autoStartModel: null, autoRepairCi: true });
      if (request.method === 'PUT' && saveFails) return json({ message: 'nope' }, 500);
      if (request.method === 'DELETE') return deleteFails ? json({ message: 'nope' }, 500) : new Response(null, { status: 200 });
      if (path.endsWith('/run')) {
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });

        return json({ started: [1], skipped: [] });
      }

      return json({});
    }),
  );
});

describe('SchedulesTab', () => {
  it('lists the schedules by the time they run, earliest first — not in the order they were made', async () => {
    schedules = [
      { ...makeSchedule(1, 'Вечерний'), hour: 22, minute: 30 },
      { ...makeSchedule(2, 'Утренний'), hour: 6, minute: 15 },
      { ...makeSchedule(3, 'Ночной'), hour: 2, minute: 0 },
    ];
    renderTab();

    await screen.findByText('Ночной');
    const [night, morning, evening] = ['Ночной', 'Утренний', 'Вечерний'].map((name) => screen.getByText(name));

    // each one comes after the previous in the document: 02:00, 06:15, 22:30 — not 22:30, 06:15, 02:00 as made
    expect(night.compareDocumentPosition(morning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(morning.compareDocumentPosition(evening) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks for confirmation and deletes nothing until confirmed', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Удалить: Первое' }));

    expect(await screen.findByText('Удалить расписание «Первое»?')).toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(calls).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Удалить: Первое' }));
    await user.click(await screen.findByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(calls).toEqual(['DELETE improve/schedules/1']));
  });

  it('shows an error and keeps the row when delete fails', async () => {
    deleteFails = true;
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Удалить: Первое' }));
    await user.click(await screen.findByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText(/Не удалось удалить расписание|nope/)).toBeInTheDocument();
    expect(screen.getByText('Первое')).toBeInTheDocument();
  });

  it('spins only the clicked run-now button and disables the others', async () => {
    const user = userEvent.setup();
    renderTab();

    const first = await screen.findByRole('button', { name: 'Запустить сейчас: Первое' });
    const second = screen.getByRole('button', { name: 'Запустить сейчас: Второе' });

    await user.click(first);

    await waitFor(() => expect(first).toHaveClass('g-button_loading'));
    expect(second).not.toHaveClass('g-button_loading');
    expect(second).toBeDisabled();

    releaseRun();
    await waitFor(() => expect(first).not.toHaveClass('g-button_loading'));
    expect(second).toBeEnabled();
  });

  it('shows an error instead of a blank tab when the list fails to load', async () => {
    listFails = true;
    renderTab();

    expect(await screen.findByText('Не удалось загрузить расписания')).toBeInTheDocument();
    expect(screen.queryByText('Расписаний нет')).not.toBeInTheDocument();
  });

  describe('an attached context', () => {
    it('shows which context a schedule carries', async () => {
      schedules = [makeAnalysis(1, 'Ночной анализ', 4), makeAnalysis(2, 'Без контекста', null)];
      renderTab();

      expect(await screen.findByText(/контекст: Что уже пробовали/)).toBeInTheDocument();
      expect(screen.getAllByText(/контекст:/)).toHaveLength(1);
    });

    it('attaches a context to a new nightly analysis', async () => {
      const user = userEvent.setup();
      renderTab();

      await user.click(await screen.findByRole('button', { name: /Новое расписание/ }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByText('Задачи из issues'));
      await user.click(await screen.findByText('Анализ (по 1 задаче на направление)'));
      await user.click(within(dialog).getByText('Без контекста'));
      await user.click(await screen.findByText('Договорённости'));
      await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(sent.some((call) => call.path === 'improve/schedules')).toBe(true));

      const body = sent.find((call) => call.path === 'improve/schedules')?.body as Record<string, unknown>;

      expect(body).toMatchObject({ kind: 'analysis', contextId: 3 });
    });

    it('shows the attached context when editing and can detach it', async () => {
      schedules = [makeAnalysis(1, 'Ночной анализ', 4)];
      const user = userEvent.setup();
      renderTab();

      await user.click(await screen.findByRole('button', { name: 'Изменить: Ночной анализ' }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByText('Что уже пробовали'));
      await user.click(await screen.findByText('Без контекста'));
      await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(sent.some((call) => call.method === 'PUT')).toBe(true));
      expect(sent.find((call) => call.method === 'PUT')?.body).toMatchObject({ contextId: null });
    });

    it('does not send a context at all for a schedule that never had one', async () => {
      const user = userEvent.setup();
      renderTab();

      await user.click(await screen.findByRole('button', { name: /Новое расписание/ }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(sent.some((call) => call.path === 'improve/schedules')).toBe(true));
      expect(sent.find((call) => call.path === 'improve/schedules')?.body).not.toHaveProperty('contextId');
    });
  });

  describe('weekdays', () => {
    it('lists the chosen days in the row', async () => {
      schedules = [{ ...makeSchedule(1, 'Будничное'), weekdays: [1, 2, 3, 4, 5] }, makeSchedule(2, 'Ежедневное')];
      renderTab();

      expect(await screen.findByText(/Пн–Пт в 02:00/)).toBeInTheDocument();
      expect(screen.getByText(/каждый день в 02:00/)).toBeInTheDocument();
    });

    it('saves the workday preset sorted, and null for every day', async () => {
      const user = userEvent.setup();
      renderTab();

      await user.click(await screen.findByRole('button', { name: /Новое расписание/ }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Будни' }));
      await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(sent.some((call) => call.path === 'improve/schedules')).toBe(true));
      expect(sent.find((call) => call.path === 'improve/schedules')?.body).toMatchObject({ weekdays: [1, 2, 3, 4, 5] });
    });

    it('refuses to save with no day selected', async () => {
      schedules = [{ ...makeSchedule(1, 'Одно'), weekdays: [3] }];
      const user = userEvent.setup();
      renderTab();

      await user.click(await screen.findByRole('button', { name: 'Изменить: Одно' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(within(dialog).getByRole('group', { name: 'Дни недели' })).getByRole('button', { name: 'Ср' }));
      await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

      expect(await within(dialog).findByText('Выберите хотя бы один день недели')).toBeInTheDocument();
      expect(sent).toEqual([]);
    });
  });
});

describe('row enable switch', () => {
  it('sends enabled: false with the other fields unchanged, without opening the dialog', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('switch', { name: 'Включено: Первое' }));

    await waitFor(() => expect(sent.some((call) => call.path === 'improve/schedules/1')).toBe(true));
    expect(sent.find((call) => call.path === 'improve/schedules/1')?.body).toMatchObject({
      name: 'Первое',
      enabled: false,
      hour: 2,
      minute: 0,
      timezone: 'Europe/Moscow',
      count: 5,
      model: 'sonnet',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an error when the toggle fails', async () => {
    saveFails = true;
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('switch', { name: 'Включено: Первое' }));

    expect(await screen.findByText(/Не удалось изменить расписание|nope/)).toBeInTheDocument();
  });
});

describe('only on new commits', () => {
  it('saves the switch for an analysis schedule', async () => {
    schedules = [{ ...makeAnalysis(1, 'Ночной анализ', null), onlyOnNewCommits: false }];
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Изменить: Ночной анализ' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('switch', { name: 'Только если в ветке появились новые коммиты' }));
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.some((call) => call.method === 'PUT')).toBe(true));
    expect(sent.find((call) => call.method === 'PUT')?.body).toMatchObject({ onlyOnNewCommits: true });
  });
});
