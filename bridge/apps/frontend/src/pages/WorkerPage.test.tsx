import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { generateKeyPair, encryptBuffer } from '@pipe/protocol/encryption';

import { WorkerPage } from './WorkerPage';
import { store } from '../store';
import { storageApi, vpnApi, workerApi } from '../store/api';
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

const CLAUDE_USAGE = {
  sessionPercent: 42,
  sessionResetsAt: '2026-10-02T15:00:00.000Z',
  weekPercent: 17,
  weekResetsAt: '2026-10-08T00:00:00.000Z',
  weekSonnetPercent: 5,
};

const CONNECTION_LINK = {
  link: 'vless://client-uuid@203.0.113.5:443?security=reality&encryption=none&pbk=pub-key&fp=chrome&sni=www.samsung.com&sid=abc123&spx=%2F&type=tcp&flow=xtls-rprx-vision#pipe-vpn',
};

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
  store.dispatch(vpnApi.util.resetApiState());

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = request.url;

      if (url.includes('/worker/jobs/1')) return jsonResponse(JOBS[0]);
      if (url.includes('/worker/jobs/2')) return jsonResponse(JOBS[1]);
      if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
      if (url.includes('/storage')) return jsonResponse(FILES);
      if (url.endsWith('/vpn/claude-usage')) return jsonResponse(CLAUDE_USAGE);
      if (url.endsWith('/vpn/connection-link')) return jsonResponse(CONNECTION_LINK);

      return jsonResponse([]);
    }),
  );
});

describe('WorkerPage', () => {
  it('renders the connection link and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    renderPage();

    expect(await screen.findByDisplayValue(CONNECTION_LINK.link)).toBeTruthy();

    await user.click(screen.getByText('Скопировать'));

    expect(writeText).toHaveBeenCalledWith(CONNECTION_LINK.link);
    expect(await screen.findByText('Скопировано')).toBeTruthy();
  });

  it('renders Claude usage limits', async () => {
    renderPage();

    expect(await screen.findByText('Текущая сессия')).toBeTruthy();
    expect(screen.getAllByText('42%').length).toBeGreaterThan(0);
    expect(screen.getByText('Эта неделя')).toBeTruthy();
    expect(screen.getAllByText('17%').length).toBeGreaterThan(0);
    expect(screen.getByText('Полный сброс')).toBeTruthy();
  });

  it('saves the Claude OAuth refresh token', async () => {
    const user = userEvent.setup();
    let credentialBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/claude-usage')) return jsonResponse(CLAUDE_USAGE);
        if (url.endsWith('/vpn/connection-link')) return jsonResponse(CONNECTION_LINK);
        if (url.endsWith('/vpn/claude-oauth-credential') && request.method === 'POST') {
          credentialBody = JSON.parse(await request.clone().text());
          return new Response(null, { status: 204 });
        }
        if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
        if (url.includes('/storage')) return jsonResponse(FILES);
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Текущая сессия');

    const input = screen.getByPlaceholderText('refresh token');
    await user.type(input, 'my-refresh-token');

    const field = input.closest('label');
    if (!field) throw new Error('field wrapper not found');
    await user.click(within(field).getByText('Сохранить'));

    await waitFor(() =>
      expect(credentialBody).toEqual({ refreshToken: 'my-refresh-token' }),
    );
    expect(await screen.findByText('Сохранено')).toBeTruthy();
  });

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
