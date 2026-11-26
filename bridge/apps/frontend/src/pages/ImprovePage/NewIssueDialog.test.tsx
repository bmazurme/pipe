import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { IssuesTab } from './IssuesTab';
import { store } from '../../store';
import { improveApi } from '../../store/api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let created: Array<Record<string, unknown>>;
let createResponse: () => Response;

beforeEach(() => {
  created = [];
  createResponse = () => json({ number: 7, htmlUrl: 'u', missingLabels: [] });
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (path === 'improve/issues' && request.method === 'POST') {
        created.push((await request.json()) as Record<string, unknown>);

        return createResponse();
      }
      if (path === 'improve/issues') return json([]);
      if (path === 'contexts') return json([{ id: 3, name: 'Договорённости', contentLength: 10, createdAt: 'x', updatedAt: 'x', schedules: [] }]);

      return json({});
    }),
  );
});

async function openDialog() {
  const user = userEvent.setup();

  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <IssuesTab configured />
      </ThemeProvider>
    </Provider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Новая задача' }));
  await user.type(await screen.findByLabelText('Заголовок'), 'Моя идея');

  return user;
}

describe('NewIssueDialog', () => {
  it('submits the title and closes', async () => {
    const user = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ title: 'Моя идея', start: false });
    await waitFor(() => expect(screen.queryByLabelText('Заголовок')).toBeNull());
  });

  it('shows the model picker up front and creates without starting', async () => {
    const user = await openDialog();

    expect(within(screen.getByRole('dialog')).getByText('Модель:')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ start: false });
    expect(created[0].model).toBeUndefined();
  });

  it('«Создать и запустить» sends start together with the chosen model', async () => {
    const user = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Создать и запустить' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ start: true, model: 'sonnet' });
  });

  it('«Создать и запустить» sends the chosen context, and «Создать» sends none', async () => {
    const user = await openDialog();
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByText('Без контекста'));
    await user.click(await screen.findByText('Договорённости'));
    await user.click(screen.getByRole('button', { name: 'Создать и запустить' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ start: true, contextId: 3 });
  });

  it('does not send a context with a plain «Создать» (nothing is started)', async () => {
    const user = await openDialog();
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByText('Без контекста'));
    await user.click(await screen.findByText('Договорённости'));
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ start: false });
    expect(created[0].contextId).toBeUndefined();
  });

  it('keeps both buttons off until there is a title', async () => {
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <IssuesTab configured />
        </ThemeProvider>
      </Provider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Новая задача' }));
    await screen.findByLabelText('Заголовок');

    expect(screen.getByRole('button', { name: 'Создать' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Создать и запустить' })).toBeDisabled();
  });

  it('keeps the dialog open with the error on failure', async () => {
    createResponse = () => json({ message: 'GitHub недоступен' }, 502);
    const user = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByText(/GitHub недоступен/)).toBeTruthy();
    expect(screen.getByLabelText('Заголовок')).toBeTruthy();
  });

  it('warns when the loop label was dropped', async () => {
    createResponse = () => json({ number: 7, htmlUrl: 'u', missingLabels: ['loop'] });
    const user = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByText(/без метки loop/)).toBeTruthy();
  });
});
