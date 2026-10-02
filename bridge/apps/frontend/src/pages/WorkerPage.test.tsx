import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { generateKeyPair, encryptBuffer } from '@pipe/protocol/encryption';

import { WorkerPage } from './WorkerPage';
import { store } from '../store';
import { storageApi, workerApi } from '../store/api';
import { uploadWithProgress } from './storage/uploadWithProgress';

vi.mock('./storage/uploadWithProgress', () => ({
  uploadWithProgress: vi.fn(),
}));

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

  it('offers encrypted parcels in the picker, marked as locked', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Задача #1');

    await user.click(screen.getByText('Посылка'));
    expect(await screen.findByText(/🔒 402-8\.subscription\.zip\.enc/)).toBeTruthy();
  });

  it('shows the empty-storage message only when there are no files at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.includes('/worker/jobs')) return jsonResponse([]);
        if (url.includes('/storage')) return jsonResponse([]);
        return jsonResponse([]);
      }),
    );

    renderPage();

    expect(await screen.findByText(/В Storage нет посылок/)).toBeTruthy();
  });

  it('requires a decrypt key before an encrypted parcel can be submitted', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Задача #1');

    await user.click(screen.getByText('Посылка'));
    await user.click(await screen.findByText(/🔒 402-8\.subscription\.zip\.enc/));

    expect(await screen.findByPlaceholderText('-----BEGIN PRIVATE KEY-----')).toBeTruthy();
    expect(screen.getByText('Запустить').closest('button')).toBeDisabled();
  });

  // RSA-4096 keygen + a real Web Crypto RSA-OAEP decrypt genuinely takes a
  // few seconds — this is the one test actually exercising that, not a
  // hang.
  it('decrypts an encrypted parcel client-side, re-uploads it, and creates the job against the new file', { timeout: 15000 }, async () => {
    const user = userEvent.setup();
    const { publicKey, privateKey } = generateKeyPair();
    const plaintext = Buffer.from('decrypted parcel bytes', 'utf-8');
    const envelope = encryptBuffer(plaintext, publicKey);

    vi.mocked(uploadWithProgress).mockResolvedValue({
      id: 99,
      originalName: '402-8.subscription.zip',
      mimeType: 'application/zip',
      size: plaintext.length,
      createdAt: '2026-09-30T07:00:00.000Z',
    });

    let createJobBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;

        if (url.includes('/worker/jobs') && method === 'POST') {
          createJobBody = JSON.parse(await request.clone().text());
          return jsonResponse({ ...JOBS[0], id: 3, sourceFileId: 99 });
        }
        if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
        if (url.endsWith('/storage/12/peek')) {
          return new Response(new Uint8Array(envelope), { status: 200 });
        }
        if (url.includes('/storage')) return jsonResponse(FILES);

        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Задача #1');

    await user.click(screen.getByText('Посылка'));
    await user.click(await screen.findByText(/🔒 402-8\.subscription\.zip\.enc/));

    await user.type(await screen.findByPlaceholderText('-----BEGIN PRIVATE KEY-----'), privateKey);

    await user.click(screen.getByText('Модель'));
    await user.click(await screen.findByText('GPT'));

    await user.click(screen.getByText('Запустить'));

    await waitFor(() => expect(uploadWithProgress).toHaveBeenCalledTimes(1));
    const [uploadedBlob, uploadedName] = vi.mocked(uploadWithProgress).mock.calls[0];
    expect(uploadedName).toBe('402-8.subscription.zip');
    expect(Buffer.from(await (uploadedBlob as Blob).arrayBuffer())).toEqual(plaintext);

    await waitFor(() => expect(createJobBody).toEqual({ sourceFileId: 99, model: 'gpt' }));
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
