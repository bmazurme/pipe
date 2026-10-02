import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { VpnPage } from './VpnPage';
import { store } from '../store';
import { vpnApi } from '../store/api';

const STATUS = {
  lastOnline: new Date(Date.now() - 60_000).toISOString(),
  upBytes: 2048,
  downBytes: 1024 * 1024 * 3,
  sni: 'www.samsung.com',
  fingerprint: 'chrome',
  port: 443,
};

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <VpnPage />
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  store.dispatch(vpnApi.util.resetApiState());
});

describe('VpnPage', () => {
  it('renders connection status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByText('www.samsung.com')).toBeTruthy();
    expect(await screen.findByText('443')).toBeTruthy();
    expect(await screen.findByText(/активно/)).toBeTruthy();
  });

  it('triggers a sync request and shows the result', async () => {
    const user = userEvent.setup();
    let syncCalled = false;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (request.url.endsWith('/vpn/sync') && request.method === 'POST') {
          syncCalled = true;
          return new Response(null, { status: 204 });
        }
        return jsonResponse({});
      }),
    );

    renderPage();
    await screen.findByText('www.samsung.com');

    await user.click(screen.getByText('Синхронизировать настройки'));

    await waitFor(() => expect(syncCalled).toBe(true));
    expect(await screen.findByText(/Запущен передеплой/)).toBeTruthy();
  });

  it('saves a worker provider key', async () => {
    const user = userEvent.setup();
    let secretBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (request.url.endsWith('/vpn/worker-secrets') && request.method === 'POST') {
          secretBody = JSON.parse(await request.clone().text());
          return new Response(null, { status: 204 });
        }
        return jsonResponse({});
      }),
    );

    renderPage();
    await screen.findByText('www.samsung.com');

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
});
