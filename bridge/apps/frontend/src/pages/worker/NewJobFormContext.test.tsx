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
let earlierRuns: number;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  earlierRuns = 2;
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
      if (path === 'storage/files' || path === 'storage') return json([{ id: 1, originalName: 'task.subscription.zip', size: 10, createdAt: '2026-10-08T00:00:00Z' }]);
      if (path === 'worker/jobs/history') return json({ count: earlierRuns });
      if (path === 'contexts') return json([{ id: 3, name: 'Project notes', content: 'Use pnpm.', createdAt: 'x', updatedAt: 'x' }]);

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

describe('NewJobForm context', () => {
  it('attaches no context by default, and says so', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(await screen.findByText(/Контекст не прикреплён/)).toBeTruthy();
    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(sent.some((call) => call.path === 'worker/jobs')).toBe(true));
    const body = sent.find((call) => call.path === 'worker/jobs')?.body as Record<string, unknown>;

    expect(body).not.toHaveProperty('contextId');
    expect(body).not.toHaveProperty('includeHistory');
  });

  it('sends the chosen context with the job', async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(await screen.findByText('Без контекста'));
    await user.click(await screen.findByText('Project notes'));

    expect(await screen.findByText(/прикреплено: копия выбранного контекста\./)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(sent.find((call) => call.path === 'worker/jobs')?.body).toMatchObject({ contextId: 3, model: 'gpt' }));
  });

  it('mixes in earlier runs on their own, without a context', async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(await screen.findByText('Подмешать итоги прошлых запусков (2)'));

    expect(await screen.findByText(/прикреплено: итоги прошлых запусков\./)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(sent.find((call) => call.path === 'worker/jobs')?.body).toMatchObject({ includeHistory: true }));
    expect(sent.find((call) => call.path === 'worker/jobs')?.body).not.toHaveProperty('contextId');
  });

  it('can carry the context and the earlier runs together', async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(await screen.findByText('Без контекста'));
    await user.click(await screen.findByText('Project notes'));
    await user.click(await screen.findByText('Подмешать итоги прошлых запусков (2)'));

    expect(await screen.findByText(/прикреплено: копия выбранного контекста и итоги прошлых запусков/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(sent.find((call) => call.path === 'worker/jobs')?.body).toMatchObject({ contextId: 3, includeHistory: true }));
  });

  it('does not offer earlier runs when the task has none', async () => {
    const user = userEvent.setup();
    earlierRuns = 0;
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');

    expect(await screen.findByText(/по этой задаче их ещё нет/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /прошлых запусков/ }).hasAttribute('disabled')).toBe(true);
  });
});
