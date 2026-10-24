import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import type { WorkerJob } from '../../store/api';
import { ExtendJobButton } from './ExtendJobButton';

const makeJob = (over: Partial<WorkerJob>) => ({ id: 901, model: 'sonnet', status: 'running', cancelRequestedAt: null, ...over }) as WorkerJob;

const renderButton = (job: WorkerJob) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ExtendJobButton job={job} />
      </ThemeProvider>
    </Provider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ExtendJobButton', () => {
  it('posts +30 minutes for a running Claude job', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      void request;
      return new Response(JSON.stringify({ id: 901 }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderButton(makeJob({}));

    await userEvent.setup().click(screen.getByRole('button', { name: '+30 мин' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/v1/worker/jobs/901/extend');
    expect(await request.json()).toEqual({ minutes: 30 });
  });

  it('is hidden for a finished job and for a non-Claude one', () => {
    renderButton(makeJob({ status: 'succeeded' }));
    renderButton(makeJob({ id: 902, model: 'gpt' }));

    expect(screen.queryByRole('button', { name: '+30 мин' })).toBeNull();
  });
});
