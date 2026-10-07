import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { LogsSection } from './LogsSection';
import { store } from '../../store';
import { logsApi } from '../../store/api';

const SUMMARY = {
  days: 7,
  total: 3,
  byLevel: { info: 1, error: 1, warn: 1 },
  bySource: { job: 2, http: 1 },
  jobs: { succeeded: 1, failed: 1, successRate: 0.5, avgDurationMs: 185_000 },
  topErrors: [{ message: 'Job N failed: timed out after Ns', count: 2 }],
  slowestRoutes: [{ route: '/api/v1/storage', count: 1, maxMs: 3200 }],
};

const ENTRIES = [
  { id: 3, createdAt: new Date().toISOString(), level: 'error', source: 'job', event: 'job.failed', message: 'Job 7 failed: timed out', meta: null },
  { id: 2, createdAt: new Date().toISOString(), level: 'warn', source: 'http', event: 'http.slow', message: 'GET /api/v1/storage → 200 in 3200ms', meta: null },
  { id: 1, createdAt: new Date().toISOString(), level: 'info', source: 'job', event: 'job.succeeded', message: 'Job 6 succeeded', meta: null },
];

const requested: string[] = [];

function renderSection() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <LogsSection />
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  requested.length = 0;
  store.dispatch(logsApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requested.push(new URL(request.url).pathname + new URL(request.url).search);

      if (request.url.includes('/logs/export')) return new Response('{"a":1}\n', { status: 200 });
      if (request.url.includes('/logs/summary')) return new Response(JSON.stringify(SUMMARY), { status: 200, headers: { 'content-type': 'application/json' } });

      return new Response(JSON.stringify(ENTRIES), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

describe('LogsSection', () => {
  it('summarises job outcomes and recurring failures', async () => {
    renderSection();

    expect(await screen.findByText('50%')).toBeTruthy();
    expect(screen.getByText('3 мин 05 с')).toBeTruthy();
    expect(screen.getByText('Job N failed: timed out after Ns')).toBeTruthy();
    expect(screen.getByText('/api/v1/storage')).toBeTruthy();
  });

  it('shows only warnings and errors by default, everything on request', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(await screen.findByText('Job 7 failed: timed out')).toBeTruthy();
    expect(screen.queryByText('Job 6 succeeded')).toBeNull();

    await user.click(screen.getByText('Все события'));

    expect(screen.getByText('Job 6 succeeded')).toBeTruthy();
  });

  it('refetches for another period', async () => {
    const user = userEvent.setup();
    renderSection();

    await screen.findByText('50%');
    await user.click(screen.getByText('30 дней'));

    await waitFor(() => expect(requested.some((path) => path.includes('logs/summary?days=30'))).toBe(true));
  });

  it('downloads the export through the API client', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    renderSection();

    await screen.findByText('50%');
    await user.click(screen.getByRole('button', { name: /Скачать NDJSON/ }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(requested.some((path) => path.includes('logs/export?days=7'))).toBe(true);
  });
});
