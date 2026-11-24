import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import type { WorkerJob } from '../../store/api';
import { StartNowButton } from './StartNowButton';

const future = () => new Date(Date.now() + 3600_000).toISOString();
const makeJob = (over: Partial<WorkerJob>) => ({ id: 911, status: 'queued', notBefore: future(), ...over }) as WorkerJob;

const renderButton = (job: WorkerJob) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <StartNowButton job={job} />
      </ThemeProvider>
    </Provider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StartNowButton', () => {
  it('posts to start-now for a delayed queued job', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      void request;
      return new Response(JSON.stringify({ id: 911 }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderButton(makeJob({}));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Запустить сейчас' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/v1/worker/jobs/911/start-now');
  });

  it('is hidden for a non-delayed or non-queued job', () => {
    renderButton(makeJob({ notBefore: null }));
    renderButton(makeJob({ id: 912, status: 'running' }));

    expect(screen.queryByRole('button', { name: 'Запустить сейчас' })).toBeNull();
  });

  it('shows an error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Задача уже не ждёт запуска' }), { status: 400, headers: { 'content-type': 'application/json' } })),
    );
    renderButton(makeJob({ id: 913 }));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Запустить сейчас' }));

    expect(await screen.findByText('Задача уже не ждёт запуска')).toBeTruthy();
  });
});
