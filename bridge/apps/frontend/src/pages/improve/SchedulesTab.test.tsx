import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  lastRunAt: null,
  lastResult: null,
});

const SCHEDULES = [makeSchedule(1, 'Первое'), makeSchedule(2, 'Второе')];

let calls: string[];
let listFails: boolean;
let deleteFails: boolean;
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
  listFails = false;
  deleteFails = false;
  releaseRun = () => undefined;
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') calls.push(`${request.method} ${path}`);
      if (path === 'improve/schedules' && request.method === 'GET') {
        return listFails ? json({ message: 'boom' }, 500) : json(SCHEDULES);
      }
      if (path === 'improve/settings') return json({ autoStartModel: null, autoRepairCi: true });
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
});
