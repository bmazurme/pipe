import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { RouterTab } from './RouterTab';
import { store } from '../../store';
import { labApi, workerApi } from '../../store/api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SETTINGS = {
  tierModels: { '1': 'haiku', '2': 'haiku', '3': 'sonnet', '4': 'opus' },
  rules: [{ name: 'AliExpress', keywords: 'aliexpress', model: 'opus', enabled: true }],
};

let sent: { method: string; path: string; body: unknown }[];
let saveReply: () => Response;
let previewReply: () => Response;

beforeEach(() => {
  sent = [];
  saveReply = () => json(SETTINGS);
  previewReply = () => json({ model: 'haiku', source: 'classifier', tier: 1, reason: 'Ярус 1 из 4 — haiku' });
  store.dispatch(labApi.util.resetApiState());
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') sent.push({ method: request.method, path, body: await request.clone().json().catch(() => undefined) });
      if (path === 'router/settings') return request.method === 'PUT' ? saveReply() : json(SETTINGS);
      if (path === 'router/preview') return previewReply();
      if (path === 'worker/provider-credentials') return json([{ id: 9, provider: 'custom', name: 'Mac M2', model: 'qwen3' }]);

      return json([]);
    }),
  );
});

const renderTab = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RouterTab />
      </ThemeProvider>
    </Provider>,
  );

describe('RouterTab', () => {
  it('shows the model of each tier and the rules as they are saved', async () => {
    renderTab();

    expect(await screen.findByDisplayValue('AliExpress')).toBeTruthy();
    expect(screen.getByLabelText('Ключевые слова')).toHaveValue('aliexpress');
    expect(screen.getByText(/Ярус 3 — несколько файлов/)).toBeTruthy();
  });

  it('saves what was changed: a tier\'s model, a new rule', async () => {
    const user = userEvent.setup();

    renderTab();
    await screen.findByDisplayValue('AliExpress');

    await user.click(screen.getAllByText('Claude Haiku')[0]);
    await user.click(await screen.findByText('Claude Sonnet', { selector: '[role="option"] *, [role="option"]' }));
    await user.click(screen.getByRole('button', { name: 'Добавить правило' }));
    await user.type(screen.getAllByLabelText('Название правила')[1], 'Fusion');
    await user.type(screen.getAllByLabelText('Ключевые слова')[1], 'fusion, корпус');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.method === 'PUT')).toBeDefined());

    const body = sent.find((call) => call.method === 'PUT')!.body as typeof SETTINGS;

    expect(body.tierModels['1']).toBe('sonnet');
    expect(body.rules).toHaveLength(2);
    expect(body.rules[1]).toMatchObject({ name: 'Fusion', keywords: 'fusion, корпус', enabled: true });
    expect(await screen.findByText('Сохранено')).toBeTruthy();
  });

  it('removes a rule', async () => {
    const user = userEvent.setup();

    renderTab();
    await screen.findByDisplayValue('AliExpress');
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent.find((call) => call.method === 'PUT')).toBeDefined());
    expect((sent.find((call) => call.method === 'PUT')!.body as typeof SETTINGS).rules).toEqual([]);
  });

  it('shows the server\'s reason when saving is refused', async () => {
    saveReply = () => json({ message: 'Правило «X»: неизвестная модель «y»' }, 400);
    const user = userEvent.setup();

    renderTab();
    await screen.findByDisplayValue('AliExpress');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText(/неизвестная модель «y»/)).toBeTruthy();
    expect(screen.queryByText('Сохранено')).toBeNull();
  });

  it('tries the router on a task and shows the choice with its reason, without saving anything', async () => {
    const user = userEvent.setup();

    renderTab();
    await screen.findByDisplayValue('AliExpress');

    const button = screen.getByRole('button', { name: 'Показать выбор' });

    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Текст задачи'), 'Fix a typo in the README');
    await user.click(button);

    expect(await screen.findByText('Ярус 1 из 4 — haiku')).toBeTruthy();
    expect(sent.find((call) => call.path === 'router/preview')?.body).toEqual({ task: 'Fix a typo in the README', executor: 'any' });
    expect(sent.some((call) => call.method === 'PUT')).toBe(false);
  });
});
