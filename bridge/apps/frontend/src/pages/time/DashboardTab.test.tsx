import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimePage } from '../TimePage';
import { store } from '../../store';
import { reportPeriodSet } from '../../store/slices';
import { timeApi } from '../../store/api';

let entries: unknown[];
let dayOffs: unknown[];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  entries = [];
  dayOffs = [];
  store.dispatch(timeApi.util.resetApiState());
  store.dispatch(reportPeriodSet({ year: 2026, month: 10 }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;

      if (path.endsWith('time/reports')) return json(entries);
      if (path.endsWith('time/day-offs')) return json(dayOffs);

      return json([]);
    }),
  );
});

const renderDashboard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={['/time']}>
          <TimePage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('Time dashboard', () => {
  it('is the first tab and opens by default', async () => {
    renderDashboard();

    expect(await screen.findByRole('tab', { name: 'Дашборд', selected: true })).toBeTruthy();
  });

  it('shows hours against the month norm and the task counts', async () => {
    entries = [
      { id: 1, year: 2026, month: 10, taskName: 'a', status: 'Закрыта', hours: 40 },
      { id: 2, year: 2026, month: 10, taskName: 'b', status: 'В работе', hours: 48 },
    ];
    renderDashboard();

    // October 2026 has 22 working days: a norm of 176 hours.
    expect(await screen.findByText('из 176 ч нормы')).toBeTruthy();
    expect(screen.getByText('88')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('Осталось 88 ч')).toBeTruthy();
    expect(screen.getByText('Задач всего').nextElementSibling?.textContent).toBe('2');
    expect(screen.getByText('Закрыто').nextElementSibling?.textContent).toBe('1');
  });

  it('warns when the booked hours go over the norm', async () => {
    entries = [{ id: 1, year: 2026, month: 10, taskName: 'a', status: 'Закрыта', hours: 200 }];
    renderDashboard();

    expect(await screen.findByText('Превышение нормы часов')).toBeTruthy();
    expect(screen.getByText('Превышение на 24 ч')).toBeTruthy();
  });

  it('takes this account’s days off into the norm', async () => {
    dayOffs = [{ id: 1, date: '2026-10-06', type: 'off' }];
    renderDashboard();

    await waitFor(() => expect(screen.getByText('из 168 ч нормы')).toBeTruthy());
  });

  it('points at the Report tab when there is no report for the month', async () => {
    renderDashboard();

    expect(await screen.findByText(/За этот месяц отчёта нет/)).toBeTruthy();
  });
});
