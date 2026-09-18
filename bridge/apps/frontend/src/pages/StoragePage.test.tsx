import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { StoragePage } from './StoragePage';
import { store } from '../store';
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
