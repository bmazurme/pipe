import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store } from '../store';
import { usageApi } from '../store/api';
import { formatCost, formatDuration, formatTokens } from '../shared/lib/usageFormat';
import { UsagePage } from './UsagePage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const totals = (over = {}) => ({ jobs: 3, failed: 1, machineSeconds: 5400, tokens: 2_500_000, costUsd: 4.2, withoutCost: 0, ...over });

const REPORT = {
  from: '2026-10-01T00:00:00Z',
  to: '2026-10-30T00:00:00Z',
  totals: totals({ withoutCost: 2 }),
  pullRequests: 1,
  costPerPullRequest: 3.5,
  byModel: [{ model: 'opus', ...totals({ jobs: 1, failed: 0, costUsd: 3.5 }) }, { model: 'sonnet', ...totals({ jobs: 2, costUsd: 0.7 }) }],
  tasks: [
    { key: 'improve:7', kind: 'improve', title: 'Issue #7: Cache lists', outcome: 'pr_open', prNumber: 55, prUrl: 'https://github.com/o/r/pull/55', firstAt: '2026-10-29T00:00:00Z', lastAt: '2026-10-29T01:00:00Z', ...totals({ jobs: 2, costUsd: 3.5 }) },
    { key: '9001:12', kind: 'parcel', title: '9001:12', outcome: null, prNumber: null, prUrl: null, firstAt: '2026-10-28T00:00:00Z', lastAt: '2026-10-28T01:00:00Z', ...totals({ jobs: 1, failed: 0, costUsd: 0.7 }) },
  ],
};

const renderPage = () => {
  store.dispatch(usageApi.util.resetApiState());

  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <UsagePage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
};

describe('formatting', () => {
  it('words durations, token counts and costs', () => {
    expect(formatDuration(45)).toBe('45 с');
    expect(formatDuration(600)).toBe('10 мин');
    expect(formatDuration(5400)).toBe('1 ч 30 мин');
    expect(formatDuration(7200)).toBe('2 ч');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(48_000)).toBe('48 тыс');
    expect(formatTokens(2_500_000)).toBe('2.5 млн');
    expect(formatCost(4.2)).toBe('$4.20');
    expect(formatCost(0.004)).toBe('$0.0040');
    expect(formatCost(0)).toBe('$0.00');
  });
});

describe('UsagePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the totals, the models and each task with its pull request', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requested.push(new URL(request.url).search);

        return json(REPORT);
      }),
    );
    renderPage();

    expect(await screen.findByText('Условная стоимость')).toBeTruthy();
    expect(screen.getByText('$4.20')).toBeTruthy();
    expect(screen.getByText(/у 2 запусков стоимости нет/)).toBeTruthy();
    expect(screen.getByText(/в среднем \$3\.50 на задачу/)).toBeTruthy();
    expect(requested[0]).toBe('?days=30');

    const issue = screen.getByText('Issue #7: Cache lists').closest('tr') as HTMLElement;

    expect(within(issue).getByRole('link', { name: 'PR #55' }).getAttribute('href')).toBe('https://github.com/o/r/pull/55');
    expect(within(issue).getByText('PR открыт')).toBeTruthy();
    expect(within(issue).getByText('(1 ош.)')).toBeTruthy();
    expect(screen.getByText('opus')).toBeTruthy();
  });

  it('asks again for another period', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requested.push(new URL(request.url).search);

        return json(REPORT);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('30 дней'));
    await user.click(await screen.findByRole('option', { name: '7 дней' }));

    await vi.waitFor(() => expect(requested).toContain('?days=7'));
  });

  it('says so when the period had no runs, and shows an error when the report fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...REPORT, totals: totals({ jobs: 0 }), tasks: [], byModel: [] })));
    const first = renderPage();

    expect(await screen.findByText('За период запусков не было')).toBeTruthy();
    first.unmount();

    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderPage();

    expect(await screen.findByText(/boom|Не удалось загрузить отчёт/)).toBeTruthy();
  });
});
