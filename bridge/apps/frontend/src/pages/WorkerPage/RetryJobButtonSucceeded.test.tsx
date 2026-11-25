import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { WorkerJob } from '../../store/api';
import { RetryJobButton } from './RetryJobButton';

const makeJob = (sourceFileId: number | null) =>
  ({ id: 7, model: 'sonnet', status: 'succeeded', sourceFileId, createdAt: '2026-10-08T00:00:00Z' }) as unknown as WorkerJob;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let calls: { path: string; body: Record<string, unknown> }[];

const renderButton = (job: WorkerJob) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RetryJobButton job={job} />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      if (path.endsWith('/retry')) {
        calls.push({ path, body: (await request.json()) as Record<string, unknown> });

        return json({ id: 8 });
      }

      return json([]);
    }),
  );
});

describe('RetryJobButton on a succeeded job', () => {
  it('shows «Запустить снова» when the source parcel is kept', () => {
    renderButton(makeJob(1));

    expect(screen.getByRole('button', { name: 'Запустить снова' })).toBeTruthy();
  });

  it('is hidden when the source was consumed', () => {
    renderButton(makeJob(null));

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('posts the retry with the chosen model', async () => {
    const user = userEvent.setup();
    renderButton(makeJob(1));

    await user.click(screen.getByRole('button', { name: /другой моделью/ }));
    await user.click(await screen.findByText('Claude Sonnet'));
    await user.click(await screen.findByText('Claude Opus'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Перезапустить' }));

    await waitFor(() => expect(calls).toEqual([{ path: 'worker/jobs/7/retry', body: { model: 'opus' } }]));
  });
});
