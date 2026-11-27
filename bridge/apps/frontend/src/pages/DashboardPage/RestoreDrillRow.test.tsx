import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi, type DashboardRestoreDrill } from '../../store/api';
import { RestoreDrillRow } from './RestoreDrillRow';
import { daysAgo, drillFacts } from './restoreDrillFacts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const daysBack = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const GOOD: DashboardRestoreDrill = {
  status: 'ok',
  reasons: [],
  lastAt: daysBack(3),
  lastOkAt: daysBack(3),
  backupAgeHours: 9,
  restoreSeconds: 75,
  nextDueAt: daysBack(-27),
  counts: { users: 2 },
  recent: [{ ranAt: daysBack(3), host: 'mac', ok: true, backupCreatedAt: '20261109T030000Z', restoreSeconds: 75, tables: 41, rows: 12_345, lastMigration: 'X', error: null }],
};

const renderRow = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RestoreDrillRow />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('daysAgo', () => {
  it('counts whole days in Russian', () => {
    const now = Date.parse('2026-12-10T12:00:00Z');

    expect(daysAgo('2026-12-10T05:00:00Z', now)).toBe('сегодня');
    expect(daysAgo('2026-12-09T05:00:00Z', now)).toBe('1 день назад');
    expect(daysAgo('2026-12-07T05:00:00Z', now)).toBe('3 дня назад');
    expect(daysAgo('2026-11-05T05:00:00Z', now)).toBe('35 дней назад');
  });
});

describe('drillFacts', () => {
  it('lists the measured recovery point, the restore time and what came back', () => {
    expect(drillFacts(GOOD)).toEqual(['копия была старше базы на 9 ч', 'загрузилась за 75 с', `41 таблиц, ${(12_345).toLocaleString('ru-RU')} строк`]);
  });

  it('shows minutes for a long restore and nothing for what is unknown', () => {
    expect(drillFacts({ ...GOOD, restoreSeconds: 600, backupAgeHours: null, recent: [] })).toEqual(['загрузилась за 10 мин']);
  });
});

describe('RestoreDrillRow', () => {
  it('says when the last good restore was and what it measured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(GOOD)));
    renderRow();

    expect(await screen.findByText('восстановление проверено 3 дня назад')).toBeTruthy();
    expect(screen.getByText(/копия была старше базы на 9 ч/)).toBeTruthy();
  });

  it('is explicit when it was never done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ ...GOOD, status: 'warn', reasons: ['Учение восстановления ещё ни разу не проводилось'], lastAt: null, lastOkAt: null, backupAgeHours: null, restoreSeconds: null, recent: [] })),
    );
    renderRow();

    expect(await screen.findByText('восстановление не проверялось')).toBeTruthy();
    expect(screen.getByText('Учение восстановления ещё ни разу не проводилось')).toBeTruthy();
  });

  it('shows why a drill is a problem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...GOOD, status: 'bad', reasons: ['Восстановление не проверялось 36 дн'] })));
    renderRow();

    expect(await screen.findByText('Восстановление не проверялось 36 дн')).toBeTruthy();
  });

  it('renders nothing when the request fails (the tile above it already has its own error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderRow();

    await vi.waitFor(() => expect(screen.queryByTestId('restore-drill')).toBeNull());
  });
});
