import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { WorkerPage } from './WorkerPage';
import { store } from '../store';
import { storageApi, workerApi } from '../store/api';

const JOBS = [
  {
    id: 1,
    sourceFileId: 10,
    resultFileId: null,
    model: 'gpt',
    status: 'running',
    logs: 'starting up\n',
    errorMessage: null,
    workerName: 'worker-host-1',
    claimedAt: '2026-09-30T10:00:00.000Z',
    startedAt: '2026-09-30T10:00:05.000Z',
    finishedAt: null,
    createdAt: '2026-09-30T09:59:00.000Z',
    updatedAt: '2026-09-30T10:00:05.000Z',
  },
  {
    id: 2,
    sourceFileId: 11,
    resultFileId: 20,
    model: 'sonnet',
    status: 'succeeded',
    logs: 'done\n',
    errorMessage: null,
    workerName: 'worker-host-1',
    claimedAt: '2026-09-30T08:00:00.000Z',
    startedAt: '2026-09-30T08:00:05.000Z',
    finishedAt: '2026-09-30T08:05:00.000Z',
    createdAt: '2026-09-30T07:59:00.000Z',
    updatedAt: '2026-09-30T08:05:00.000Z',
  },
];

const FILES = [
  { id: 10, originalName: '402-6.subscription.zip', mimeType: 'application/zip', size: 1024, createdAt: '2026-09-30T09:00:00.000Z' },
  { id: 11, originalName: '402-7.subscription.zip', mimeType: 'application/zip', size: 2048, createdAt: '2026-09-30T08:00:00.000Z' },
  { id: 12, originalName: '402-8.subscription.zip.enc', mimeType: 'application/zip', size: 4096, createdAt: '2026-09-30T07:00:00.000Z' },
];

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <WorkerPage />
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  // RTK Query caches per store instance — without resetting it, a later
  // test mounting the same query (listFiles/listJobs) would just see
  // whatever an earlier test already cached instead of hitting its own
  // fresh mock.
  store.dispatch(storageApi.util.resetApiState());
  store.dispatch(workerApi.util.resetApiState());

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = request.url;

      if (url.includes('/worker/jobs/1')) return jsonResponse(JOBS[0]);
      if (url.includes('/worker/jobs/2')) return jsonResponse(JOBS[1]);
      if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
      if (url.includes('/storage')) return jsonResponse(FILES);

      return jsonResponse([]);
    }),
  );
});

describe('WorkerPage', () => {
  it('lists jobs with their model and status', async () => {
    renderPage();

    await screen.findByText('Задача #1');
    expect(screen.getByText('Задача #2')).toBeTruthy();
    expect(screen.getByText(/Выполняется/)).toBeTruthy();
    expect(screen.getByText('Готово')).toBeTruthy();
  });

  it('excludes encrypted parcels from the create-job picker', async () => {
    renderPage();

    await screen.findByText('Задача #1');

    // The picker only shows a Select when at least one eligible (non-.enc)
    // file exists — both plain files here qualify, so the form renders
    // instead of the "no eligible parcels" message.
    expect(screen.queryByText(/В Storage нет доступных посылок/)).toBeNull();
  });

  it('shows the "no eligible parcels" message when every stored file is encrypted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.includes('/worker/jobs')) return jsonResponse([]);
        if (url.includes('/storage')) return jsonResponse([FILES[2]]);
        return jsonResponse([]);
      }),
    );

    renderPage();

    expect(
      await screen.findByText(/В Storage нет доступных посылок/),
    ).toBeTruthy();
  });

  it('opens a job detail dialog with its logs on click', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Задача #1'));

    expect(await screen.findByText('starting up')).toBeTruthy();
    expect(screen.getByText(/worker-host-1/)).toBeTruthy();
  });

  it('offers a download action for a succeeded job but not a running one', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Задача #1'));
    await screen.findByText('starting up');
    expect(screen.queryByRole('button', { name: /Скачать результат/ })).toBeNull();

    await user.click(screen.getByText('Закрыть'));
    await waitFor(() => expect(screen.queryByText('starting up')).toBeNull());

    await user.click(screen.getByText('Задача #2'));
    expect(await screen.findByRole('button', { name: /Скачать результат/ })).toBeTruthy();
  });

  it('does not offer delete while a job is running, but does once it has succeeded', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Задача #1'));
    await screen.findByText('starting up');
    expect(screen.queryByRole('button', { name: /Удалить/ })).toBeNull();

    await user.click(screen.getByText('Закрыть'));
    await waitFor(() => expect(screen.queryByText('starting up')).toBeNull());

    await user.click(screen.getByText('Задача #2'));
    expect(await screen.findByRole('button', { name: /Удалить/ })).toBeTruthy();
  });
});
