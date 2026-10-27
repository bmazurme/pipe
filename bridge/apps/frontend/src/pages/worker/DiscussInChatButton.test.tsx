import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import type { WorkerJob } from '../../store/api';
import { DiscussInChatButton } from './DiscussInChatButton';

const makeJob = (over: Partial<WorkerJob>) => ({ id: 77, model: 'sonnet', status: 'failed', ...over }) as WorkerJob;

const json = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Location() {
  const location = useLocation();

  return <div data-testid="location">{location.pathname + location.search}</div>;
}

const renderButton = (job: WorkerJob) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={['/worker']}>
          <DiscussInChatButton job={job} />
          <Location />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiscussInChatButton', () => {
  it.each(['succeeded', 'failed', 'cancelled'] as const)('is shown for a %s job', (status) => {
    renderButton(makeJob({ status }));

    expect(screen.getByRole('button', { name: 'Обсудить в чате' })).toBeInTheDocument();
  });

  it.each(['queued', 'claimed', 'running'] as const)('is hidden for a %s job', (status) => {
    renderButton(makeJob({ status }));

    expect(screen.queryByRole('button', { name: 'Обсудить в чате' })).toBeNull();
  });

  it('creates a chat, attaches the job, then opens the chat', async () => {
    const paths: string[] = [];
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        paths.push(`${request.method} ${new URL(request.url).pathname}`);
        bodies.push(await request.json());

        return json({ id: 42 });
      }),
    );
    renderButton(makeJob({}));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Обсудить в чате' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/chat?chat=42'));
    expect(paths).toEqual(['POST /api/v1/chat/chats', 'POST /api/v1/chat/chats/42/run-results']);
    expect(bodies[0]).toEqual({ model: 'sonnet' });
    expect(bodies[1]).toEqual({ jobId: 77 });
  });

  it('shows the error and offers the created chat when the attach fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (++call === 1 ? json({ id: 43 }) : json({ message: 'Run is not finished' }, 400))),
    );
    renderButton(makeJob({}));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Обсудить в чате' }));

    expect(await screen.findByText('Не удалось прикрепить результат')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/worker');

    await user.click(screen.getByRole('button', { name: 'Открыть чат' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/chat?chat=43');
  });
});
