import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { WorkerJob } from '../../store/api';
import { RetryJobButton } from './RetryJobButton';

const job = (status: string) => ({ id: 7, model: 'sonnet', status, createdAt: '2026-10-08T00:00:00Z' }) as unknown as WorkerJob;

let calls: string[];
let reply: () => Response;

const renderButton = (j: WorkerJob, compact = true) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RetryJobButton job={j} compact={compact} />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  calls = [];
  reply = () => new Response(JSON.stringify({ id: 8 }), { status: 200, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      calls.push(`${request.method} ${new URL(request.url).pathname.replace('/api/v1/', '')}`);

      return reply();
    }),
  );
});

describe('RetryJobButton', () => {
  it.each(['failed', 'cancelled'])('retries a %s job', async (status) => {
    const user = userEvent.setup();
    renderButton(job(status));

    await user.click(screen.getByRole('button', { name: 'Перезапустить: задача #7' }));

    await waitFor(() => expect(calls).toContain('POST worker/jobs/7/retry'));
  });

  it.each(['queued', 'running', 'succeeded'])('offers nothing for a %s job', (status) => {
    renderButton(job(status));

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says why a retry was refused', async () => {
    const user = userEvent.setup();
    reply = () => new Response(JSON.stringify({ message: 'The source parcel was already consumed' }), { status: 409, headers: { 'content-type': 'application/json' } });
    renderButton(job('failed'), false);

    await user.click(screen.getByRole('button', { name: 'Перезапустить' }));

    expect(await screen.findByText('The source parcel was already consumed')).toBeTruthy();
  });
});
