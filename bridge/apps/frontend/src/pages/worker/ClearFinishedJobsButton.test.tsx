import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { ClearFinishedJobsButton } from './ClearFinishedJobsButton';

let calls: string[];

const renderButton = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ClearFinishedJobsButton />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname.replace('/api/v1/', '')}${url.search}`);

      return new Response(JSON.stringify({ removed: 5 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

describe('ClearFinishedJobsButton', () => {
  it('deletes nothing until the dialog is confirmed', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: 'Очистить завершённые' }));
    expect(screen.getByText('Очистить завершённые задачи?')).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith('DELETE'))).toHaveLength(0);
  });

  it('sends the chosen age on confirm and shows how many were removed', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: 'Очистить завершённые' }));
    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText('Удалено: 5')).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain('DELETE worker/jobs?olderThanDays=30'));
  });
});
