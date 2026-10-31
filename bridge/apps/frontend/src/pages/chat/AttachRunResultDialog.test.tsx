import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { chatApi } from '../../store/api';
import { AttachRunResultDialog } from './AttachRunResultDialog';

const job = (id: number, status: string) => ({ id, model: 'sonnet', status, logs: '', errorMessage: null, taskKey: null, createdAt: 'x', updatedAt: '2026-10-22T10:00:00.000Z' });

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let jobs: unknown[];
let failWith: { status: number; message: string } | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  jobs = [job(3, 'succeeded'), job(4, 'running'), job(2, 'failed')];
  failWith = null;
  store.dispatch(chatApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      const path = url.pathname.replace('/api/v1/', '');

      if (request.method === 'GET') return json(jobs);

      sent.push({ method: request.method, path, body: await request.json().catch(() => undefined) });

      return failWith ? json({ message: failWith.message }, failWith.status) : json({ id: 9, model: 'sonnet', title: null, createdAt: 'x', updatedAt: 'x' });
    }),
  );
});

const renderDialog = (onClose = vi.fn()) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <AttachRunResultDialog chatId={9} onClose={onClose} />
      </ThemeProvider>
    </Provider>,
  );

// Picks run #3 and waits until the form shows it. On a loaded runner a click on the popup's option is sometimes swallowed (the list is
// still being positioned), leaving the select empty and the later "Прикрепить" with nothing to send — so a choice that did not take
// is simply made again; each try starts from whatever state the popup was left in (open or closed).
async function chooseRun3(user: ReturnType<typeof userEvent.setup>) {
  const box = () => screen.getByRole('combobox', { name: 'Запуск' });

  await waitFor(
    async () => {
      if (/#3/.test(box().textContent ?? '')) return;

      if (!screen.queryByText(/#3 · sonnet/)) await user.click(box());
      await user.click(await screen.findByText(/#3 · sonnet/, undefined, { timeout: 1500 }));
      await waitFor(() => expect(box()).toHaveTextContent(/#3/), { timeout: 1500 });
    },
    { timeout: 12_000, interval: 100 },
  );
}

describe('AttachRunResultDialog', () => {
  it('lists only finished runs and posts the chosen one to the chat', async () => {
    const onClose = vi.fn();
    renderDialog(onClose);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: 'Запуск' }));
    expect(await screen.findByText(/#3 · sonnet · готово/)).toBeTruthy();
    expect(screen.queryByText(/#4/)).toBeNull();
    // The click on "Прикрепить" must come after the choice has reached the form: on a slow runner it used to race the select and send nothing.
    await chooseRun3(user);
    await user.click(screen.getByRole('button', { name: 'Прикрепить' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 5000 });
    expect(sent).toEqual([{ method: 'POST', path: 'chat/chats/9/run-results', body: { jobId: 3 } }]);
  });

  it('asks to pick a run before sending', async () => {
    renderDialog();
    const user = userEvent.setup();

    await screen.findByRole('combobox', { name: 'Запуск' });
    await user.click(screen.getByRole('button', { name: 'Прикрепить' }));

    expect(await screen.findByText('Сначала выберите запуск из списка')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('shows the server error and stays open', async () => {
    failWith = { status: 409, message: 'This run is already attached to the chat' };
    const onClose = vi.fn();
    renderDialog(onClose);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: 'Запуск' }));
    await chooseRun3(user);
    await user.click(screen.getByRole('button', { name: 'Прикрепить' }));

    expect(await screen.findByText(/Не удалось прикрепить результат|уже/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
