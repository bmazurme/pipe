import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { workerApi } from '../../store/api';
import type { WorkerJob } from '../../store/api';
import { FailureDiagnosisCard } from './FailureDiagnosisCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const job = (over: Partial<WorkerJob>): WorkerJob =>
  ({ id: 5, status: 'failed', model: 'sonnet', claudeCredentialId: 1, usedClaudeCredentialName: 'main', errorMessage: null, ...over }) as WorkerJob;

let sent: Array<{ method: string; path: string; body: unknown }> = [];

const stubFetch = (retryStatus = 201) => {
  sent = [];
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      const body = request.method === 'GET' ? undefined : await request.clone().json().catch(() => undefined);

      if (request.method !== 'GET') sent.push({ method: request.method, path, body });
      if (path === 'worker/claude-credentials') return json([{ id: 1, name: 'main', limits: null, authFailedAt: null }, { id: 2, name: 'spare', limits: null, authFailedAt: null }]);
      if (path.endsWith('/retry')) return retryStatus === 201 ? json({ id: 77 }, 201) : json({ message: 'Only a failed job can be retried' }, 409);

      return json([]);
    }),
  );
};

const renderCard = (j: WorkerJob) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <FailureDiagnosisCard job={j} />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('FailureDiagnosisCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is absent for a job that did not fail or fails for an unknown reason', () => {
    stubFetch();
    const { container } = renderCard(job({ errorMessage: 'Model run exited with code 1: segfault' }));

    expect(container.textContent).toBe('');
  });

  it('after a timeout offers a longer limit and retries the job with it', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderCard(job({ errorMessage: 'claude timed out after 1800s and was killed' }));

    await user.click(await screen.findByRole('button', { name: 'Повторить с лимитом 60 мин' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'worker/jobs/5/retry', body: { timeoutSec: 3600 } }));
    expect(await screen.findByText('Запущено как задача #77.')).toBeTruthy();
  });

  it('after a revoked token retries on the other token and links to the keys', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderCard(job({ errorMessage: 'Failed to authenticate: OAuth token revoked. Please log in again' }));

    expect(await screen.findByRole('link', { name: 'Открыть токены' })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Повторить на токене «spare»' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'worker/jobs/5/retry', body: { claudeCredentialId: 2 } }));
  });

  it("shows bridge's reason when the retry is refused", async () => {
    stubFetch(409);
    const user = userEvent.setup();
    renderCard(job({ errorMessage: 'claude timed out after 600s and was killed' }));

    await user.click(await screen.findByRole('button', { name: /Повторить с лимитом/ }));

    expect(await screen.findByText('Only a failed job can be retried')).toBeTruthy();
  });
});
