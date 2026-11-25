import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { workerApi } from '../../store/api';
import { WorkerJob } from '../../store/api';
import { limitResetAt } from './claudeLimits';
import { RetryJobButton } from './RetryJobButton';

const resetsAt = Math.floor(Date.now() / 1000) + 3600;
const LIMIT_ERROR = "Model run exited with code 1: You've hit your session limit · resets 5am (UTC)";
const limits = (status = 'rejected', reset: number | null = resetsAt) => ({
  status,
  rateLimitType: 'five_hour',
  isUsingOverage: false,
  windows: { five_hour: { utilization: 1, resetsAt: reset } },
  reportedAt: new Date().toISOString(),
});

const job = (errorMessage: string) =>
  ({ id: 7, model: 'sonnet', status: 'failed', claudeCredentialId: 3, errorMessage, createdAt: '2026-10-08T00:00:00Z' }) as unknown as WorkerJob;

let bodies: string[];
let credentialLimits: unknown;

const renderButton = (j: WorkerJob) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RetryJobButton job={j} compact={false} />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  bodies = [];
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

      if (path.endsWith('/worker/claude-credentials')) return json([{ id: 3, name: 't', createdAt: '', limits: credentialLimits, authFailedAt: null, authFailedJobId: null }]);
      bodies.push(await request.text());

      return json({ id: 8 });
    }),
  );
});

describe('RetryJobButton after a session limit', () => {
  it('offers a delayed restart and sends the reset time as notBefore', async () => {
    credentialLimits = limits();
    const user = userEvent.setup();
    renderButton(job(LIMIT_ERROR));

    await user.click(await screen.findByRole('button', { name: /после сброса лимита/ }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(new Date(JSON.parse(bodies[0]).notBefore).getTime()).toBeGreaterThan(resetsAt * 1000);
  });

  it('does not offer it for another failure', async () => {
    credentialLimits = limits();
    renderButton(job('boom'));

    await screen.findByRole('button', { name: 'Перезапустить' });
    expect(screen.queryByRole('button', { name: /после сброса лимита/ })).toBeNull();
  });

  it('does not offer it when no reset time is known', async () => {
    credentialLimits = limits('rejected', null);
    renderButton(job(LIMIT_ERROR));

    await screen.findByRole('button', { name: 'Перезапустить' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: /после сброса лимита/ })).toBeNull();
  });
});

describe('limitResetAt', () => {
  it('ignores resets in the past and beyond 7 days', () => {
    const now = Date.now();

    expect(limitResetAt(LIMIT_ERROR, limits('rejected', Math.floor(now / 1000) - 10), now)).toBeNull();
    expect(limitResetAt(LIMIT_ERROR, limits('rejected', Math.floor(now / 1000) + 8 * 86400), now)).toBeNull();
    expect(limitResetAt(LIMIT_ERROR, null, now)).toBeNull();
  });
});
