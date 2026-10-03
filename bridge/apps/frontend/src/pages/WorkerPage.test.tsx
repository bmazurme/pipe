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

const VPN_CONNECTIONS = [
  { id: 1, name: 'primary', serverAddress: '203.0.113.5', isActive: true, createdAt: '2026-09-30T07:00:00.000Z' },
  { id: 2, name: 'backup', serverAddress: '203.0.113.6', isActive: false, createdAt: '2026-09-30T08:00:00.000Z' },
];

const CLAUDE_CREDENTIALS = [
  { id: 1, name: 'personal', createdAt: '2026-09-30T07:00:00.000Z' },
  { id: 2, name: 'work', createdAt: '2026-09-30T08:00:00.000Z' },
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
  store.dispatch(vpnApi.util.resetApiState());

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = request.url;

      if (url.includes('/worker/jobs/1')) return jsonResponse(JOBS[0]);
      if (url.includes('/worker/jobs/2')) return jsonResponse(JOBS[1]);
      if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
      if (url.includes('/storage')) return jsonResponse(FILES);
      if (url.endsWith('/vpn/connections')) return jsonResponse(VPN_CONNECTIONS);

      return jsonResponse([]);
    }),
  );
});

describe('WorkerPage', () => {
  it('shows the active VPN connection and activates another one on selection', async () => {
    const user = userEvent.setup();
    let activatedId: number | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/connections')) return jsonResponse(VPN_CONNECTIONS);
        if (url.endsWith('/vpn/connections/2/activate') && request.method === 'POST') {
          activatedId = 2;
          return new Response(null, { status: 204 });
        }
        if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
        if (url.includes('/storage')) return jsonResponse(FILES);
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Задача #1');

    expect(screen.getByText('primary')).toBeTruthy();

    await user.click(screen.getByText('primary'));
    await user.click(await screen.findByText('backup'));

    await waitFor(() => expect(activatedId).toBe(2));
  });

  it('saves a worker provider key', async () => {
    const user = userEvent.setup();
    let secretBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/connections')) return jsonResponse(VPN_CONNECTIONS);
        if (url.endsWith('/vpn/worker-secrets') && request.method === 'POST') {
          secretBody = JSON.parse(await request.clone().text());
          return new Response(null, { status: 204 });
        }
        if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
        if (url.includes('/storage')) return jsonResponse(FILES);
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Задача #1');

    const input = screen.getByPlaceholderText('sk-proj-...');
    await user.type(input, 'sk-test-key');

    // TextInput also renders its own built-in "Clear" icon button ahead of
    // ours in DOM order — a plain querySelector('button') would grab that
    // one instead, so this scopes to the field and matches by visible text.
    const openAiField = input.closest('label');
    if (!openAiField) throw new Error('field wrapper not found');
    await user.click(within(openAiField).getByText('Сохранить'));

    await waitFor(() =>
      expect(secretBody).toEqual({ name: 'WORKER_OPENAI_API_KEY', value: 'sk-test-key' }),
    );
  });

  it('lists Claude credentials and deletes one', async () => {
    const user = userEvent.setup();
    let deletedId: number | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/connections')) return jsonResponse(VPN_CONNECTIONS);
        if (url.endsWith('/worker/claude-credentials')) return jsonResponse(CLAUDE_CREDENTIALS);
        if (url.includes('/worker/claude-credentials/') && request.method === 'DELETE') {
          deletedId = Number(url.split('/').pop());
          return new Response(null, { status: 204 });
        }
        if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
        if (url.includes('/storage')) return jsonResponse(FILES);
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('personal');
    expect(screen.getByText('work')).toBeTruthy();

    await user.click(screen.getByLabelText('Удалить токен: personal'));

    await waitFor(() => expect(deletedId).toBe(1));
  });

  it('adds a Claude credential', async () => {
    const user = userEvent.setup();
    let createdBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/connections')) return jsonResponse(VPN_CONNECTIONS);
        if (url.endsWith('/worker/claude-credentials') && request.method === 'POST') {
          createdBody = JSON.parse(await request.clone().text());
          return jsonResponse({ id: 3, name: createdBody && (createdBody as { name: string }).name, createdAt: '2026-10-03T00:00:00.000Z' });
        }
        if (url.endsWith('/worker/claude-credentials')) return jsonResponse([]);
        if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
        if (url.includes('/storage')) return jsonResponse(FILES);
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Задача #1');

    await user.type(screen.getByPlaceholderText('Название (например, личный)'), 'personal');
    await user.type(screen.getByPlaceholderText('claude token'), 'sk-ant-oat-test');
    await user.click(screen.getByText('Добавить'));

    await waitFor(() =>
      expect(createdBody).toEqual({ name: 'personal', token: 'sk-ant-oat-test' }),
    );
  });

  it('defaults to the first Claude credential and sends it when creating a Sonnet job', async () => {
    const user = userEvent.setup();
    let createJobBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        const method = request.method;
        if (url.endsWith('/vpn/connections')) return jsonResponse(VPN_CONNECTIONS);
        if (url.endsWith('/worker/claude-credentials')) return jsonResponse(CLAUDE_CREDENTIALS);
        if (url.includes('/worker/jobs') && method === 'POST') {
          createJobBody = JSON.parse(await request.clone().text());
          return jsonResponse({ ...JOBS[1], id: 3 });
        }
        if (url.includes('/worker/jobs')) return jsonResponse(JOBS);
        if (url.includes('/storage')) return jsonResponse(FILES);
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Задача #1');

    await user.click(screen.getByText('Посылка'));
    await user.click(await screen.findByText('402-6.subscription.zip'));

    await user.click(screen.getByText('Модель'));
    await user.click(await screen.findByText('Claude Sonnet'));

    await user.click(screen.getByText('Запустить'));

    await waitFor(() =>
      expect(createJobBody).toEqual({ sourceFileId: 10, model: 'sonnet', claudeCredentialId: 1 }),
    );
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
  // hang. 15s was enough locally but timed out on a slower CI runner; 30s
  // gives real headroom without masking an actual hang.
  it('decrypts an encrypted parcel client-side, re-uploads it, and creates the job against the new file', { timeout: 30000 }, async () => {
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
