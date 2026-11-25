import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewJobForm } from './NewJobForm';
import { store } from '../../store';
import { contextApi, storageApi, workerApi } from '../../store/api';

type Sent = { path: string; body: unknown };
let sent: Sent[];
let credentials: unknown[];
let providerKeys: unknown[];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  credentials = [];
  providerKeys = [];
  store.dispatch(contextApi.util.resetApiState());
  store.dispatch(workerApi.util.resetApiState());
  store.dispatch(storageApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') {
        sent.push({ path, body: await request.json().catch(() => undefined) });

        return json({ id: 50 });
      }
      if (path === 'storage/files' || path === 'storage') return json([{ id: 1, originalName: 'task.subscription.zip', size: 10, createdAt: '2026-10-08T00:00:00Z' }]);
      if (path === 'worker/jobs/history') return json({ count: 0 });
      if (path === 'worker/claude-credentials') return json(credentials);
      if (path === 'worker/provider-credentials') return json(providerKeys);

      return json([]);
    }),
  );
  try {
    localStorage.clear();
  } catch {
    // Not available — the form must work without it.
  }
});

const renderForm = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <NewJobForm onCreated={() => {}} />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

async function pick(user: ReturnType<typeof userEvent.setup>, placeholder: string, option: string) {
  await user.click(await screen.findByText(placeholder));
  await user.click(await screen.findByText(option));
}

const jobBody = () => sent.find((call) => call.path === 'worker/jobs')?.body;

const key = (id: number, name: string, model: string) => ({ id, provider: 'custom', name, model, keyHint: '' });

describe('NewJobForm — a custom model', () => {
  it('runs on the server of a key: the first is preselected, and it can be changed', async () => {
    providerKeys = [key(9, 'Локальная Qwen', 'qwen2.5-coder:7b'), key(12, 'Yandex', 'yandexgpt')];
    const user = userEvent.setup();
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'Другая модель (свой сервер)');
    expect(await screen.findByText('Локальная Qwen · qwen2.5-coder:7b')).toBeTruthy();
    expect(screen.queryByText('Ключ по умолчанию (первый)')).toBeNull();

    await user.click(screen.getByText('Локальная Qwen · qwen2.5-coder:7b'));
    await user.click(await screen.findByText('Yandex · yandexgpt'));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(jobBody()).toBeDefined());
    expect(jobBody()).toMatchObject({ model: 'custom', providerCredentialId: 12 });
  });

  it('cannot be started without a key, and points to where to add one', async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'Другая модель (свой сервер)');

    expect(await screen.findByText(/Нет ни одного ключа для своей модели/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Запустить/ })).toBeDisabled();
  });
});
