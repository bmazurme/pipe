import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { workerApi } from '../../store/api';
import { ProviderCredentialsCard } from './ProviderCredentialsCard';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: string[];
let listReply: () => Response;
let deleteReply: () => Response;

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ProviderCredentialsCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  calls = [];
  store.dispatch(workerApi.util.resetApiState());
  listReply = () =>
    json([{ id: 5, provider: 'gpt', name: 'рабочий', keyHint: 'sk-…abcd', createdAt: '2026-10-08T00:00:00Z' }]);
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

describe('ProviderCredentialsCard', () => {
  it('shows an error with a retry when the list fails to load', async () => {
    const user = userEvent.setup();
    listReply = () => json({ message: 'boom' }, 500);
    renderCard();

    expect(await screen.findByText('Не удалось загрузить список ключей')).toBeTruthy();

    listReply = () => json([]);
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText(/Ключей пока нет/)).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить список ключей')).toBeNull();
  });

  it('shows an empty state for an empty list', async () => {
    listReply = () => json([]);
    renderCard();

    expect(await screen.findByText(/Ключей пока нет/)).toBeTruthy();
  });

  it('labels the name and key inputs', async () => {
    renderCard();

    expect(await screen.findByLabelText('Название ключа')).toBeTruthy();
    expect(screen.getByLabelText('API-ключ')).toBeTruthy();
  });

  it('makes no request when the delete confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Удалить ключ: рабочий' }));
    expect(await screen.findByText('Удалить ключ?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByText('Удалить ключ?')).toBeNull());
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });

  it('deletes after confirmation', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Удалить ключ: рабочий' }));
    await user.click(await screen.findByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(calls).toContain('DELETE worker/provider-credentials/5'));
  });

  it('shows an error when the delete fails', async () => {
    const user = userEvent.setup();
    deleteReply = () => json({ message: 'nope' }, 500);
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Удалить ключ: рабочий' }));
    await user.click(await screen.findByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText('Не удалось удалить ключ «рабочий»')).toBeTruthy();
  });
});
