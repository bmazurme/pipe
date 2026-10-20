import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('sends start and model when the switch is on', async () => {
    const user = await openDialog();

    await user.click(screen.getByText('Сразу запустить'));
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ start: true });
    expect(created[0].model).toBeTruthy();
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
