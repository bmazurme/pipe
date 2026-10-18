import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { workerApi } from '../../store/api';
import { ClaudeCredentialsCard } from './ClaudeCredentialsCard';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: string[];
let listReply: () => Response;
let deleteReply: () => Response;

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ClaudeCredentialsCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  calls = [];
  store.dispatch(workerApi.util.resetApiState());
  listReply = () => json([{ id: 3, name: 'личный', createdAt: '2026-10-08T00:00:00Z' }]);
  deleteReply = () => new Response(null, { status: 204 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      calls.push(`${request.method} ${path}`);

      return request.method === 'DELETE' ? deleteReply() : listReply();
    }),
  );
});

describe('ClaudeCredentialsCard', () => {
  it('shows an error with a retry when the list fails to load', async () => {
    const user = userEvent.setup();
    listReply = () => json({ message: 'boom' }, 500);
    renderCard();

    expect(await screen.findByText('Не удалось загрузить список токенов')).toBeTruthy();

    listReply = () => json([]);
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText(/Токенов пока нет/)).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить список токенов')).toBeNull();
  });

  it('flags a token Anthropic rejected, with the job number', async () => {
    listReply = () =>
      json([
        {
          id: 3,
          name: 'личный',
          createdAt: '2026-10-08T00:00:00Z',
          authFailedAt: new Date().toISOString(),
          authFailedJobId: 57,
        },
      ]);
    renderCard();

    expect(await screen.findByText(/Отклонён Anthropic · задача #57/)).toBeTruthy();
  });

  it('shows no rejected label for a healthy token', async () => {
    renderCard();

    await screen.findByText('личный');
    expect(screen.queryByText(/Отклонён Anthropic/)).toBeNull();
  });

  it('shows an empty state for an empty list', async () => {
    listReply = () => json([]);
    renderCard();

    expect(await screen.findByText(/Токенов пока нет/)).toBeTruthy();
  });

  it('makes no request when the delete confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Удалить токен: личный' }));
    expect(await screen.findByText('Удалить токен?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByText('Удалить токен?')).toBeNull());
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });

  it('deletes after confirmation', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Удалить токен: личный' }));
    await user.click(await screen.findByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(calls).toContain('DELETE worker/claude-credentials/3'));
  });

  it('shows an error when the delete fails', async () => {
    const user = userEvent.setup();
    deleteReply = () => json({ message: 'nope' }, 500);
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Удалить токен: личный' }));
    await user.click(await screen.findByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText('Не удалось удалить токен «личный»')).toBeTruthy();
  });
});

describe('ClaudeCredentialsCard 7-day usage', () => {
  it('shows the week of runs, cost and tokens under a token', async () => {
    listReply = () =>
      json([
        {
          id: 3,
          name: 'личный',
          createdAt: '2026-10-08T00:00:00Z',
          usage7d: { runs: 14, costUsd: 3.2, tokens: 1_200_000 },
        },
      ]);
    renderCard();

    expect(await screen.findByText('За 7 дней: 14 запусков · $3.20 · 1.2M токенов')).toBeTruthy();
  });

  it('says there were no runs when the token has none', async () => {
    listReply = () => json([{ id: 3, name: 'личный', createdAt: '2026-10-08T00:00:00Z', usage7d: null }]);
    renderCard();

    expect(await screen.findByText('За 7 дней запусков не было')).toBeTruthy();
  });
});

describe('ClaudeCredentialsCard accessible names', () => {
  it('labels the name and token inputs of the add row', async () => {
    renderCard();

    expect(await screen.findByLabelText('Название токена')).toBeTruthy();
    expect(screen.getByLabelText('Claude-токен')).toBeTruthy();
  });
});
