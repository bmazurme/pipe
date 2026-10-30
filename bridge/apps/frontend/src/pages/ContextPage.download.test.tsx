import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextPage } from './ContextPage';
import { store } from '../store';
import { contextApi } from '../store/api';

const download = vi.hoisted(() => vi.fn());

vi.mock('../shared/lib/parcelCrypto', () => ({ triggerBlobDownload: download }));

const TEXT = 'Use pnpm.\n  No default exports.\n';
const SUMMARY = { id: 1, name: 'Project/notes: "v2"', contentLength: 29, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', schedules: [], lastUsedAt: null };
let failGet: boolean;
let methods: string[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  failGet = false;
  methods = [];
  download.mockClear();
  store.dispatch(contextApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      methods.push(request.method);
      if (path === 'contexts/1') return failGet ? json({ message: 'boom' }, 500) : json({ ...SUMMARY, content: TEXT });

      return json([SUMMARY]);
    }),
  );
});

const renderPage = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <ContextPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('ContextPage download', () => {
  it('downloads the saved text as a safe .md file without opening the editor', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: `Скачать: ${SUMMARY.name}` }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [blob, filename] = download.mock.calls[0] as [Blob, string];

    expect(filename).toBe('Project notes v2.md');
    expect(await blob.text()).toBe(TEXT);
    expect(screen.queryByLabelText('Текст контекста')).toBeNull();
    expect(methods.every((method) => method === 'GET')).toBe(true);
  });

  it('shows an error and downloads nothing when the text cannot be fetched', async () => {
    failGet = true;
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: `Скачать: ${SUMMARY.name}` }));

    expect(await screen.findByText('Не удалось скачать контекст')).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
  });
});
