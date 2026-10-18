import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { WorkerJob } from '../../store/api';
import { RetryJobButton } from './RetryJobButton';

const job = { id: 7, model: 'sonnet', status: 'failed', createdAt: '2026-10-08T00:00:00Z' } as unknown as WorkerJob;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let bodies: Record<string, unknown>[];

const renderButton = (compact: boolean) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RetryJobButton job={job} compact={compact} />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  bodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      if (path.endsWith('/retry')) {
        bodies.push((await request.json()) as Record<string, unknown>);

        return json({ id: 8 });
      }
      if (path.includes('claude-credentials')) return json([{ id: 3, name: 'Second token' }]);

      return json([]);
    }),
  );
});

describe('RetryJobButton on another model', () => {
  it('is absent from the compact list-row form', () => {
    renderButton(true);

    expect(screen.queryByRole('button', { name: /другой моделью/ })).toBeNull();
  });

  it('sends the chosen model and token', async () => {
    const user = userEvent.setup();
    renderButton(false);

    await user.click(screen.getByRole('button', { name: /другой моделью/ }));
    await user.click(await screen.findByText('Claude Sonnet'));
    await user.click(await screen.findByText('Claude Opus'));
    await user.click(screen.getByText('как в задаче'));
    await user.click(await screen.findByText('Second token'));
    await user.click(screen.getByRole('button', { name: 'Перезапустить' }));

    await waitFor(() => expect(bodies).toEqual([{ model: 'opus', claudeCredentialId: 3 }]));
  });
});
