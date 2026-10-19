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

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  credentials = [];
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

describe('NewJobForm start time', () => {
  it('sends no notBefore by default', async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(jobBody()).toBeDefined());
    expect(jobBody()).not.toHaveProperty('notBefore');
  });

  it('sends a notBefore about an hour ahead for "Через 1 час"', async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await pick(user, 'Сейчас', 'Через 1 час');
    const before = Date.now();
    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    await waitFor(() => expect(jobBody()).toHaveProperty('notBefore'));
    const at = new Date((jobBody() as { notBefore: string }).notBefore).getTime();
    expect(at).toBeGreaterThanOrEqual(before + 3_600_000 - 1000);
    expect(at).toBeLessThan(before + 3_600_000 + 60_000);
  });

  it('offers the limit reset only when the token has an upcoming one', async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 2 * 3600;
    credentials = [
      {
        id: 4,
        name: 'main',
        limits: { status: 'allowed', rateLimitType: null, reportedAt: new Date().toISOString(), windows: { five_hour: { utilization: 0.9, resetsAt } } },
      },
    ];
    const user = userEvent.setup();
    renderForm();

    await pick(user, 'Посылка', 'task.subscription.zip');
    await pick(user, 'Модель', 'GPT');
    await user.click(await screen.findByText('Сейчас'));
    expect(screen.queryByText(/После сброса лимита/)).toBeNull();
    await user.keyboard('{Escape}');

    await pick(user, 'Модель', 'Claude Sonnet');
    await user.click(await screen.findByText('Сейчас'));
    expect(await screen.findByText(/После сброса лимита/)).toBeTruthy();
  });
});
