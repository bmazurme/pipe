import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { generateKeyPair, encryptBuffer } from '@pipe/protocol/encryption';

import { StoragePage } from './StoragePage';
import { store } from '../store';
import { storageApi } from '../store/api';
import { uploadWithProgress } from './storage/uploadWithProgress';

// Uploads go around RTK Query (XHR, for progress events) — mocked here so
// the gate under test (does a leaky file even reach this call) can be
// asserted without spinning up a real XHR/network stack.
vi.mock('./storage/uploadWithProgress', () => ({
  uploadWithProgress: vi.fn(),
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <StoragePage />
      </ThemeProvider>
    </Provider>,
  );
}

function dropzone() {
  return screen.getByText('Перетащите файлы сюда').parentElement!;
}

function drop(files: File[]) {
  fireEvent.drop(dropzone(), { dataTransfer: { files } });
}

const textFile = (name: string, content: string) => new File([content], name);

beforeEach(() => {
  localStorage.clear();
  store.dispatch(storageApi.util.resetApiState());

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/storage')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/purge')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }),
  );
  vi.mocked(uploadWithProgress).mockReset().mockResolvedValue({
    id: 1,
    originalName: 'x',
    mimeType: 'text/plain',
    size: 1,
    createdAt: new Date().toISOString(),
  });
});

describe('StoragePage', () => {
  it('uploads a clean file immediately, without a confirmation dialog', async () => {
    renderPage();
    await screen.findByText('Выбрать файлы');

    drop([textFile('a.ts', 'export const x = 1;')]);

    await waitFor(() => expect(uploadWithProgress).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Похоже, в файлах остались секреты')).toBeNull();
  });

  it('blocks the upload and asks for confirmation when a file still looks leaky', async () => {
    renderPage();
    await screen.findByText('Выбрать файлы');

    drop([textFile('notes.txt', 'contact oncall@acme-corp.example')]);

    expect(await screen.findByText('Похоже, в файлах остались секреты')).toBeTruthy();
    expect(screen.getByText('email: oncall@acme-corp.example')).toBeTruthy();
    expect(uploadWithProgress).not.toHaveBeenCalled();
  });

  it('cancels without uploading', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Выбрать файлы');

    drop([textFile('notes.txt', 'contact oncall@acme-corp.example')]);
    await screen.findByText('Похоже, в файлах остались секреты');

    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    // Gravity's Dialog unmounts its content after a closing transition, not
    // synchronously on click.
    await waitFor(() =>
      expect(screen.queryByText('Похоже, в файлах остались секреты')).toBeNull(),
    );
    expect(uploadWithProgress).not.toHaveBeenCalled();
  });

  it('uploads anyway once confirmed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Выбрать файлы');

    drop([textFile('notes.txt', 'contact oncall@acme-corp.example')]);
    await screen.findByText('Похоже, в файлах остались секреты');

    await user.click(screen.getByRole('button', { name: 'Всё равно загрузить' }));

    await waitFor(() => expect(uploadWithProgress).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText('Похоже, в файлах остались секреты')).toBeNull(),
    );
  });
});

describe('StoragePage — imported decryption keys', () => {
  it('imports a named key and offers it for removal', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Выбрать файлы');

    await user.type(screen.getByPlaceholderText('Название (например, личный)'), 'personal');
    await user.type(
      screen.getByPlaceholderText('-----BEGIN PRIVATE KEY----- или -----BEGIN PUBLIC KEY-----'),
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    );
    await user.click(screen.getByText('Импортировать'));

    expect(await screen.findByText('personal')).toBeTruthy();

    await user.click(screen.getByLabelText('Удалить ключ: personal'));
    await waitFor(() => expect(screen.queryByText('personal')).toBeNull());
  });

  it('rejects text that has no PRIVATE KEY / PUBLIC KEY header', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Выбрать файлы');

    await user.type(screen.getByPlaceholderText('Название (например, личный)'), 'bad');
    await user.type(
      screen.getByPlaceholderText('-----BEGIN PRIVATE KEY----- или -----BEGIN PUBLIC KEY-----'),
      'not a key',
    );
    await user.click(screen.getByText('Импортировать'));

    expect(await screen.findByText(/нет заголовка/)).toBeTruthy();
    expect(screen.queryByText('bad')).toBeNull();
  });
});

describe('StoragePage — download failures', () => {
  // storage.controller.ts's download route used to leave a missing-on-disk
  // file (DB row survives a backend redeploy, uploads/ doesn't — see its
  // own comment) as a hung request with no response at all; it now sends
  // a 404, and this is the message that should surface for it specifically
  // rather than the generic failure text.
  it('shows a specific message for a 404 (file gone from disk), not the generic one', async () => {
    const user = userEvent.setup();
    const file = {
      id: 5,
      originalName: 'orphaned.zip',
      mimeType: 'application/zip',
      size: 10,
      createdAt: '2026-10-03T21:00:00.000Z',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes('/storage/5')) {
          return Promise.resolve(
            new Response(JSON.stringify({ message: 'File is missing on disk' }), { status: 404 }),
          );
        }
        if (url.includes('/storage')) return Promise.resolve(jsonResponse([file]));
        if (url.includes('/purge')) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(jsonResponse([]));
      }),
    );

    renderPage();
    await screen.findByText(file.originalName);

    await user.click(screen.getByLabelText(`Скачать ${file.originalName}`));

    expect(await screen.findByText('Файл отсутствует в хранилище — запись устарела')).toBeTruthy();
    expect(screen.queryByText('Не удалось скачать файл')).toBeNull();
  });
});

describe('StoragePage — delete without downloading', () => {
  const file = {
    id: 9,
    originalName: 'draft.zip',
    mimeType: 'application/zip',
    size: 20,
    createdAt: '2026-10-03T21:00:00.000Z',
  };

  // Tracks whether the delete actually *succeeded*, not merely whether it
  // was attempted — StoragePage polls /storage every 4s
  // (FILES_POLL_INTERVAL_MS), so a slow test run can easily let a real poll
  // tick land mid-test. Gating the mocked list on "was DELETE called at
  // all" (regardless of its status) made that poll return an empty list
  // even for a failed delete — a real flake this caught in CI, not a
  // hypothetical one.
  function stubFetchWithDeleteOutcome(deleteStatus: number) {
    let deleteSucceeded = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
        if (url.includes('/storage/9') && method === 'DELETE') {
          if (deleteStatus >= 200 && deleteStatus < 300) deleteSucceeded = true;
          return Promise.resolve(new Response(null, { status: deleteStatus }));
        }
        if (url.includes('/storage')) return Promise.resolve(jsonResponse(deleteSucceeded ? [] : [file]));
        if (url.includes('/purge')) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(jsonResponse([]));
      }),
    );
    return () => deleteSucceeded;
  }

  it('never calls delete until the confirmation dialog is approved', async () => {
    const user = userEvent.setup();
    const deleteSucceeded = stubFetchWithDeleteOutcome(204);

    renderPage();
    await screen.findByText(file.originalName);

    await user.click(screen.getByLabelText(`Удалить ${file.originalName}`));
    expect(await screen.findByText('Удалить файл без скачивания?')).toBeTruthy();
    expect(deleteSucceeded()).toBe(false);

    await user.click(screen.getByText('Отмена'));
    await waitFor(() => expect(screen.queryByText('Удалить файл без скачивания?')).toBeNull());
    expect(deleteSucceeded()).toBe(false);
    expect(screen.getByText(file.originalName)).toBeTruthy();
  });

  it('deletes the file and removes it from the list once confirmed', async () => {
    const user = userEvent.setup();
    const deleteSucceeded = stubFetchWithDeleteOutcome(204);

    renderPage();
    await screen.findByText(file.originalName);

    await user.click(screen.getByLabelText(`Удалить ${file.originalName}`));
    await user.click(await screen.findByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(deleteSucceeded()).toBe(true));
    await waitFor(() => expect(screen.queryByText(file.originalName)).toBeNull());
  });

  it('shows an error and keeps the dialog reachable again when delete fails', async () => {
    const user = userEvent.setup();
    stubFetchWithDeleteOutcome(500);

    renderPage();
    await screen.findByText(file.originalName);

    await user.click(screen.getByLabelText(`Удалить ${file.originalName}`));
    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText(`Не удалось удалить «${file.originalName}»`)).toBeTruthy();
    // File stays listed — the failed delete never removed it.
    await waitFor(() => expect(screen.getByText(file.originalName)).toBeTruthy());
  });
});

describe('StoragePage — opening an encrypted parcel', () => {
  // RSA-4096 keygen + a real Web Crypto RSA-OAEP decrypt genuinely takes a
  // few seconds — see the matching comment on WorkerPage's own decrypt test.
  it('decrypts a parcel via /peek (not /download) and downloads the plaintext', { timeout: 30000 }, async () => {
    const user = userEvent.setup();
    const { publicKey, privateKey } = generateKeyPair();
    const plaintext = Buffer.from('decrypted parcel bytes', 'utf-8');
    const envelope = encryptBuffer(plaintext, publicKey);

    const encFile = {
      id: 21,
      originalName: '402-6.subscription.zip.enc',
      mimeType: 'application/zip',
      size: envelope.length,
      createdAt: '2026-09-30T09:00:00.000Z',
    };

    let peeked = false;
    let downloaded = false;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.endsWith('/storage/21/peek')) {
          peeked = true;
          return Promise.resolve(new Response(new Uint8Array(envelope), { status: 200 }));
        }
        if (url.includes('/storage/21')) {
          downloaded = true;
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url.includes('/storage')) return Promise.resolve(jsonResponse([encFile]));
        if (url.includes('/purge')) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(jsonResponse([]));
      }),
    );

    renderPage();
    await screen.findByText(encFile.originalName);

    await user.click(screen.getByLabelText(`Открыть ${encFile.originalName}`));
    await user.type(await screen.findByPlaceholderText('-----BEGIN PRIVATE KEY-----'), privateKey);
    await user.click(screen.getByText('Расшифровать и скачать'));

    await waitFor(() =>
      expect(screen.queryByText(`Открыть «${encFile.originalName}»`)).toBeNull(),
    );
    expect(peeked).toBe(true);
    expect(downloaded).toBe(false);
  });
});
