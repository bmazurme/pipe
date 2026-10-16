import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { workerApi } from '../../store/api';
import type { FleetWorker } from '../../store/api';
import { REFRESH_WAIT_MS, refreshState, WorkerLimits } from './WorkerLimits';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const LIMITS = {
  status: 'allowed',
  rateLimitType: null,
  isUsingOverage: false,
  windows: { five_hour: { utilization: 0.3, resetsAt: NOW / 1000 + 3600 } },
  reportedAt: iso(10 * 60_000),
};

const worker = (over: Partial<FleetWorker> = {}): FleetWorker =>
  ({
    id: 5,
    name: 'pi-blue',
    kind: 'managed',
    state: 'idle',
    enabled: true,
    claudeLimits: LIMITS,
    limitsRefreshMin: 0,
    limitsRefreshRequestedAt: null,
    ...over,
  }) as FleetWorker;

let sent: { method: string; path: string }[];
let status: number;

beforeEach(() => {
  sent = [];
  status = 204;
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      sent.push({ method: request.method, path: new URL(request.url).pathname.replace('/api/v1', '') });

      return status === 204
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ message: 'The worker is not connected yet' }), {
            status,
            headers: { 'content-type': 'application/json' },
          });
    }),
  );
});

const view = (w: FleetWorker) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <WorkerLimits worker={w} now={NOW} />
      </ThemeProvider>
    </Provider>,
  );

describe('refreshState', () => {
  it('is idle when nothing was asked, or the worker has reported since', () => {
    expect(refreshState({ claudeLimits: LIMITS, limitsRefreshRequestedAt: null }, NOW)).toBe('idle');
    expect(refreshState({ claudeLimits: LIMITS, limitsRefreshRequestedAt: iso(20 * 60_000) }, NOW)).toBe('idle');
  });

  it('is waiting after a request the worker has not answered yet, and "no answer" once that takes too long', () => {
    expect(refreshState({ claudeLimits: LIMITS, limitsRefreshRequestedAt: iso(30_000) }, NOW)).toBe('waiting');
    expect(refreshState({ claudeLimits: null, limitsRefreshRequestedAt: iso(30_000) }, NOW)).toBe('waiting');
    expect(refreshState({ claudeLimits: LIMITS, limitsRefreshRequestedAt: iso(REFRESH_WAIT_MS + 1000) }, NOW)).toBe(
      'no-answer',
    );
  });
});

describe('WorkerLimits', () => {
  it('shows the bars and asks the worker to refresh them when the button is pressed', async () => {
    const user = userEvent.setup();
    view(worker());

    expect(screen.getByRole('group', { name: 'Лимиты Claude' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Обновить лимиты/ }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: '/workers/5/refresh-limits' }));
  });

  it('says that it waits for the answer, and blocks a second press meanwhile', () => {
    view(worker({ limitsRefreshRequestedAt: iso(20_000) }));

    expect(screen.getByText(/Запрошено, worker ответит/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Обновить лимиты/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when the worker did not answer (an old image ignores the request)', () => {
    view(worker({ limitsRefreshRequestedAt: iso(REFRESH_WAIT_MS + 60_000) }));

    expect(screen.getByText(/Worker не ответил на запрос/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Обновить лимиты/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('cannot be pressed for a worker that is not on the line', () => {
    view(worker({ state: 'offline' }));

    expect((screen.getByRole('button', { name: /Обновить лимиты/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains an empty card instead of leaving a blank, and mentions the automatic refresh when one is set', () => {
    const { unmount } = view(worker({ claudeLimits: null }));

    expect(screen.getByText(/Лимиты ещё не получены — они появятся после первого запуска или по кнопке/)).toBeTruthy();
    unmount();

    view(worker({ limitsRefreshMin: 30 }));
    expect(screen.getByText(/Обновляются сами каждые 30 мин/)).toBeTruthy();
  });

  it('shows what the server said when the request is refused', async () => {
    status = 409;
    const user = userEvent.setup();
    view(worker());

    await user.click(screen.getByRole('button', { name: /Обновить лимиты/ }));

    expect(await screen.findByText('The worker is not connected yet')).toBeTruthy();
  });
});
