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
        if (request.url.endsWith('/vpn/claude-usage')) return jsonResponse(CLAUDE_USAGE);
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByText('www.samsung.com')).toBeTruthy();
    expect(await screen.findByText('443')).toBeTruthy();
    expect(await screen.findByText(/активно/)).toBeTruthy();
  });

  it('renders Claude usage limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (request.url.endsWith('/vpn/claude-usage')) return jsonResponse(CLAUDE_USAGE);
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByText('Текущая сессия')).toBeTruthy();
    expect(screen.getAllByText('42%').length).toBeGreaterThan(0);
    expect(screen.getByText('Эта неделя')).toBeTruthy();
    expect(screen.getAllByText('17%').length).toBeGreaterThan(0);
    expect(screen.getByText('Полный сброс')).toBeTruthy();
  });

  it('renders the connection link and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (request.url.endsWith('/vpn/claude-usage')) return jsonResponse(CLAUDE_USAGE);
        if (request.url.endsWith('/vpn/connection-link')) return jsonResponse(CONNECTION_LINK);
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByDisplayValue(CONNECTION_LINK.link)).toBeTruthy();

    await user.click(screen.getByText('Скопировать'));

    expect(writeText).toHaveBeenCalledWith(CONNECTION_LINK.link);
    expect(await screen.findByText('Скопировано')).toBeTruthy();
  });

  it('provisions a new VPN server', async () => {
    const user = userEvent.setup();
    let provisionBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (request.url.endsWith('/vpn/provision') && request.method === 'POST') {
          provisionBody = JSON.parse(await request.clone().text());
          return new Response(null, { status: 204 });
        }
        return jsonResponse({});
      }),
    );

    renderPage();
    await screen.findByText('www.samsung.com');

    await user.type(screen.getByPlaceholderText('203.0.113.10'), '198.51.100.9');

    const sshUserInput = screen.getByDisplayValue('root');
    await user.clear(sshUserInput);
    await user.type(sshUserInput, 'ubuntu');

    const passwordField = screen.getByText('Пароль SSH').closest('label');
    const passwordInput = passwordField?.querySelector('input');
    if (!passwordInput) throw new Error('password input not found');
    await user.type(passwordInput, 'hunter2');

    await user.click(screen.getByText('Создать'));

    await waitFor(() =>
      expect(provisionBody).toEqual({ host: '198.51.100.9', sshUser: 'ubuntu', sshPassword: 'hunter2' }),
    );
    expect(await screen.findByText(/Запущена настройка сервера/)).toBeTruthy();
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
