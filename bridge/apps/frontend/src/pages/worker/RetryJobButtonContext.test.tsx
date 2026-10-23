import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { WorkerJob } from '../../store/api';
import { RetryJobButton } from './RetryJobButton';

const job = { id: 7, model: 'sonnet', status: 'failed', taskKey: '1:2', createdAt: '2026-10-08T00:00:00Z' } as unknown as WorkerJob;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let bodies: Record<string, unknown>[];

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
      if (path.includes('contexts')) {
        return json([
          { id: 5, name: 'Notes', content: 'n' },
          { id: 9, name: 'Ответы: 1:2', content: 'a' },
        ]);
      }

      return json([]);
    }),
  );
});

const openDialog = async () => {
  const user = userEvent.setup();
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RetryJobButton job={job} />
      </ThemeProvider>
    </Provider>,
  );
  await user.click(screen.getByRole('button', { name: /другой моделью/ }));

  return user;
};

describe('RetryJobButton context choice', () => {
  it('preselects the saved answers and sends their id', async () => {
    const user = await openDialog();
    await screen.findByText('Ответы: 1:2');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Перезапустить' }));

    await waitFor(() => expect(bodies).toEqual([{ model: 'sonnet', contextId: 9 }]));
  });

  it('sends the context picked by hand', async () => {
    const user = await openDialog();
    await user.click(await screen.findByText('Ответы: 1:2'));
    await user.click(await screen.findByText('Notes'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Перезапустить' }));

    await waitFor(() => expect(bodies).toEqual([{ model: 'sonnet', contextId: 5 }]));
  });
});
