import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewJobForm } from './NewJobForm';
import { store } from '../../store';
import { contextApi, storageApi, workerApi } from '../../store/api';

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let workers: unknown[];
let providerKeys: unknown[];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const fleetWorker = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'green',
  kind: 'managed',
  state: 'idle',
  enabled: true,
  lastSeenAt: new Date().toISOString(),
  activeJobs: 0,
  hostname: 'box',
  version: '1.0.0',
  models: null,
  pollIntervalSec: 10,
  jobTimeoutSec: 1800,
  proxyUrl: null,
  chatEnabled: true,
  keyPrefix: 'brw_AAAAAAAA',
  enrollmentPending: false,
  enrollmentExpiresAt: null,
  createdAt: '2026-10-14T00:00:00Z',
  ...over,
});

const providerKey = (over: Record<string, unknown> = {}) => ({
  id: 5,
  provider: 'gpt',
  name: 'work',
  keyHint: '…1234',
  baseUrl: null,
  model: null,
  createdAt: '2026-10-14T00:00:00Z',
  ...over,
});

beforeEach(() => {
  sent = [];
  workers = [];
  providerKeys = [];
  store.dispatch(contextApi.util.resetApiState());
  store.dispatch(workerApi.util.resetApiState());
  store.dispatch(storageApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');
      const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);

      if (request.method !== 'GET') {
        sent.push({ method: request.method, path, body });

        return json({ id: 50 });
      }
      if (path === 'storage/files' || path === 'storage') {
        return json([{ id: 1, originalName: 'task.subscription.zip', size: 10, createdAt: '2026-10-08T00:00:00Z' }]);
      }
      if (path === 'workers') return json(workers);
      if (path === 'worker/provider-credentials') return json(providerKeys);
      if (path === 'worker/jobs/history') return json({ count: 0 });

      return json([]);
    }),
  );
  try {
    localStorage.clear();
  } catch {
    // Not available — the form must work without it.
  }
});

const renderForm = (onOpenWorkers?: () => void) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <NewJobForm onCreated={() => {}} onOpenWorkers={onOpenWorkers} />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

async function pick(user: ReturnType<typeof userEvent.setup>, placeholder: string, option: string) {
  await user.click(await screen.findByText(placeholder));
  await user.click(await screen.findByText(option));
}

describe('NewJobForm — who will run it', () => {
  it('with no worker at all, says so and takes the owner to the place to add one', async () => {
    const user = userEvent.setup();
    const onOpenWorkers = vi.fn();

    renderForm(onOpenWorkers);

    expect(await screen.findByText(/Ни одного worker нет/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Добавить worker' }));

    expect(onOpenWorkers).toHaveBeenCalledTimes(1);
  });

  it('tells how many workers are free before the job is started', async () => {
    workers = [fleetWorker({ id: 1 }), fleetWorker({ id: 2, name: 'blue', state: 'busy' })];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Модель', 'Claude Sonnet');

    expect(await screen.findByText(/Свободных worker: 1 из 2/)).toBeTruthy();
  });

  it('when everybody is busy, says the job will queue; when nobody is online, says it will wait', async () => {
    workers = [fleetWorker({ state: 'busy' })];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Модель', 'Claude Sonnet');

    expect(await screen.findByText(/Все подходящие worker заняты/)).toBeTruthy();

    workers = [fleetWorker({ state: 'offline' })];
    store.dispatch(workerApi.util.invalidateTags(['Worker']));

    expect(await screen.findByText(/Ни один worker не на связи/)).toBeTruthy();
  });

  it('with no choice made the job is for any free worker — no worker is named', async () => {
    workers = [fleetWorker()];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(sent.some((call) => call.path === 'worker/jobs')).toBe(true));
    expect(sent.find((call) => call.path === 'worker/jobs')?.body).not.toHaveProperty('targetWorkerId');
  });

  it('pins the job to the worker that was chosen, and the hint follows that worker', async () => {
    workers = [fleetWorker({ id: 1 }), fleetWorker({ id: 2, name: 'blue', state: 'busy' })];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await pick(user, 'Любой свободный worker', 'blue — занят');

    expect(await screen.findByText(/«blue» занят — задача начнётся, как только он освободится/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(sent.some((call) => call.path === 'worker/jobs')).toBe(true));
    expect(sent.find((call) => call.path === 'worker/jobs')?.body).toMatchObject({ model: 'gpt', targetWorkerId: 2 });
  });

  it('offers only the workers that can run the chosen model', async () => {
    workers = [fleetWorker({ id: 1, name: 'any' }), fleetWorker({ id: 2, name: 'gpt-only', models: ['gpt'] })];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Модель', 'Claude Opus');
    await user.click(await screen.findByText('Любой свободный worker'));

    expect(await screen.findByText('any — свободен')).toBeTruthy();
    expect(screen.queryByText('gpt-only — свободен')).toBeNull();
  });

  it('does not offer a paused worker, or one that has not been connected yet', async () => {
    workers = [
      fleetWorker({ id: 1, name: 'ready' }),
      fleetWorker({ id: 2, name: 'napper', state: 'paused', enabled: false }),
      fleetWorker({ id: 3, name: 'fresh', state: 'pending', lastSeenAt: null }),
    ];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Модель', 'GPT');
    await user.click(await screen.findByText('Любой свободный worker'));

    expect(await screen.findByText('ready — свободен')).toBeTruthy();
    expect(screen.queryByText(/napper/)).toBeNull();
    expect(screen.queryByText(/fresh/)).toBeNull();
  });
});

describe('NewJobForm — API keys of gpt / deepseek / qwen', () => {
  it('without a stored key for the model, warns and points to where to add one', async () => {
    providerKeys = [];
    workers = [fleetWorker()];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Модель', 'GPT');

    expect(await screen.findByText(/нет сохранённого API-ключа/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Добавить ключ' }).getAttribute('href')).toBe('/?tab=keys');
  });

  it('never warns for a Claude model — it has its own token', async () => {
    providerKeys = [];
    workers = [fleetWorker()];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Модель', 'Claude Sonnet');
    await screen.findByText(/Свободных worker/);

    expect(screen.queryByText(/нет сохранённого API-ключа/)).toBeNull();
  });

  it('offers the keys of that provider only, defaulting to the first, and sends the one chosen', async () => {
    providerKeys = [
      providerKey({ id: 5, name: 'first' }),
      providerKey({ id: 6, name: 'second', keyHint: '…9999' }),
      providerKey({ id: 7, provider: 'qwen', name: 'other-provider' }),
    ];
    workers = [fleetWorker()];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(await screen.findByText('Ключ по умолчанию (первый)'));

    expect(await screen.findByText('second …9999')).toBeTruthy();
    expect(screen.queryByText(/other-provider/)).toBeNull();

    await user.click(screen.getByText('second …9999'));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(sent.some((call) => call.path === 'worker/jobs')).toBe(true));
    expect(sent.find((call) => call.path === 'worker/jobs')?.body).toMatchObject({
      model: 'gpt',
      providerCredentialId: 6,
    });
  });

  it('sends no key id when the default is kept', async () => {
    providerKeys = [providerKey()];
    workers = [fleetWorker()];
    const user = userEvent.setup();

    renderForm();
    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(sent.some((call) => call.path === 'worker/jobs')).toBe(true));
    expect(sent.find((call) => call.path === 'worker/jobs')?.body).not.toHaveProperty('providerCredentialId');
  });
});

describe('NewJobForm — accessible names', () => {
  it('names every select, and keeps the name after a value is picked', async () => {
    workers = [fleetWorker()];
    const user = userEvent.setup();

    renderForm();
    await screen.findByRole('combobox', { name: 'Посылка' });
    for (const name of ['Модель', 'Worker', 'Контекст']) {
      expect(screen.getByRole('combobox', { name })).toBeTruthy();
    }

    await pick(user, 'Модель', 'GPT');
    expect(screen.getByRole('combobox', { name: 'Модель' })).toBeTruthy();
  });
});
