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

const CONNECTIONS = [
  { id: 1, name: 'primary', serverAddress: '203.0.113.5', isActive: true, createdAt: '2026-09-30T07:00:00.000Z' },
  { id: 2, name: 'backup', serverAddress: '203.0.113.6', isActive: false, createdAt: '2026-09-30T08:00:00.000Z' },
];

const CONNECTION_LINK = {
  link: 'vless://client-uuid@203.0.113.6:443?security=reality&encryption=none&pbk=pub-key&fp=chrome&sni=www.samsung.com&sid=abc123&spx=%2F&type=tcp&flow=xtls-rprx-vision#pipe-vpn',
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
  it("shows the active connection's status inline on its own row, with no manual check needed", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        return jsonResponse({});
      }),
    );

    renderPage();

    const primaryRow = (await screen.findByText('primary')).closest('li');
    if (!primaryRow) throw new Error('primary row not found');

    expect(within(primaryRow).getByText('www.samsung.com')).toBeTruthy();
    expect(within(primaryRow).getByText('443')).toBeTruthy();
    expect(within(primaryRow).getByText(/^активно ·/)).toBeTruthy();
    // No separate "Проверить" for the active row — its status is already
    // live from the polled query above, not a manual per-row fetch.
    expect(within(primaryRow).queryByText('Проверить')).toBeNull();
    expect(within(primaryRow).queryByText('Сделать активным')).toBeNull();
  });

  it('formats large traffic totals in GB, not an unreadable number of MB', async () => {
    const bigTraffic = { ...STATUS, upBytes: 9_575_219_200, downBytes: 200_025_600_000 };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(bigTraffic);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByText(/↑ 8\.9 ГБ · ↓ 186\.3 ГБ/)).toBeTruthy();
  });

  it('lists connections, showing which one is active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        return jsonResponse({});
      }),
    );

    renderPage();

    await screen.findByText('primary');
    expect(screen.getByText('backup')).toBeTruthy();
    expect(screen.getByText('Активно')).toBeTruthy();
  });

  it('activates a connection', async () => {
    const user = userEvent.setup();
    let activatedId: number | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        if (url.endsWith('/vpn/connections/2/activate') && request.method === 'POST') {
          activatedId = 2;
          return new Response(null, { status: 204 });
        }
        return jsonResponse({});
      }),
    );

    renderPage();
    const backupRow = (await screen.findByText('backup')).closest('li');
    if (!backupRow) throw new Error('backup row not found');

    await user.click(within(backupRow).getByText('Сделать активным'));

    await waitFor(() => expect(activatedId).toBe(2));
  });

  it('checks a connection and shows its status', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        if (url.endsWith('/vpn/connections/2/status')) return jsonResponse(STATUS);
        return jsonResponse({});
      }),
    );

    renderPage();
    const backupRow = (await screen.findByText('backup')).closest('li');
    if (!backupRow) throw new Error('backup row not found');

    await user.click(within(backupRow).getByText('Проверить'));

    expect(await within(backupRow).findByText('443')).toBeTruthy();
  });

  it('gets a connection link and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        if (url.endsWith('/vpn/connections/2/connection-link')) return jsonResponse(CONNECTION_LINK);
        return jsonResponse({});
      }),
    );

    renderPage();
    const backupRow = (await screen.findByText('backup')).closest('li');
    if (!backupRow) throw new Error('backup row not found');

    await user.click(within(backupRow).getByText('Ссылка'));

    expect(await within(backupRow).findByDisplayValue(CONNECTION_LINK.link)).toBeTruthy();

    await user.click(within(backupRow).getByText('Скопировать'));

    expect(writeText).toHaveBeenCalledWith(CONNECTION_LINK.link);
  });

  it('deletes a connection', async () => {
    const user = userEvent.setup();
    let deletedId: number | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        if (url.includes('/vpn/connections/') && request.method === 'DELETE') {
          deletedId = Number(url.split('/').pop());
          return new Response(null, { status: 204 });
        }
        return jsonResponse({});
      }),
    );

    renderPage();
    await screen.findByText('backup');

    await user.click(screen.getByLabelText('Удалить подключение: backup'));
    // A single click only arms the button; the second one deletes.
    expect(deletedId).toBeUndefined();
    await user.click(await screen.findByLabelText('Подтвердить удаление подключения: backup'));

    await waitFor(() => expect(deletedId).toBe(2));
  });

  it('adds a new connection', async () => {
    const user = userEvent.setup();
    let createdBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (url.endsWith('/vpn/connections') && request.method === 'POST') {
          createdBody = JSON.parse(await request.clone().text());
          return jsonResponse({ id: 3, name: 'new', serverAddress: '203.0.113.7', isActive: false, createdAt: '2026-10-03T00:00:00.000Z' });
        }
        if (url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        return jsonResponse({});
      }),
    );

    renderPage();
    await screen.findByText('primary');
    await user.click(screen.getByText('Новое подключение'));

    await user.type(screen.getByPlaceholderText('Например, Нидерланды'), 'new');
    await user.type(screen.getByPlaceholderText('http://1.2.3.4:2053/abcdef'), 'http://panel.example.com');
    await user.type(screen.getByPlaceholderText('1.2.3.4'), '203.0.113.7');

    const tokenField = screen.getByText('API-токен панели').closest('label');
    const tokenInput = tokenField?.querySelector('input');
    if (!tokenInput) throw new Error('token input not found');
    await user.type(tokenInput, 'panel-token');

    await user.click(screen.getByText('Добавить подключение'));

    await waitFor(() =>
      expect(createdBody).toEqual({
        name: 'new',
        panelUrl: 'http://panel.example.com',
        panelApiToken: 'panel-token',
        serverAddress: '203.0.113.7',
      }),
    );
  });

  it('autofills server address and name from a pasted vless link', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
        return jsonResponse({});
      }),
    );

    renderPage();
    await screen.findByText('primary');
    await user.click(screen.getByText('Новое подключение'));

    await user.type(
      screen.getByPlaceholderText('vless://uuid@host:port?...#название'),
      'vless://6f760030-24e5-4a14-814f-7a6a275c125e@185.125.231.78:443?encryption=none&security=reality#vpn-main-main',
    );

    expect(screen.getByPlaceholderText('1.2.3.4')).toHaveValue('185.125.231.78');
    expect(screen.getByPlaceholderText('Например, Нидерланды')).toHaveValue('vpn-main-main');
  });

  it('provisions a new VPN server', async () => {
    const user = userEvent.setup();
    let provisionBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(STATUS);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
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
      expect(provisionBody).toEqual({
        host: '198.51.100.9',
        sshUser: 'ubuntu',
        sshPassword: 'hunter2',
        confirm: true,
      }),
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
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(CONNECTIONS);
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
});
