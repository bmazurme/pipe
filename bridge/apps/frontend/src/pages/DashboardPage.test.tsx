import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { DashboardPage } from './DashboardPage';
import { store } from '../store';
import { dashboardApi, vpnApi } from '../store/api';

const VPN_UP = {
  lastOnline: new Date(Date.now() - 60_000).toISOString(),
  upBytes: 2048,
  downBytes: 1024,
  sni: 'www.samsung.com',
  fingerprint: 'chrome',
  port: 443,
};

const ONE_ACTIVE_CONNECTION = [
  { id: 1, name: 'primary', serverAddress: '203.0.113.5', isActive: true, createdAt: '2026-09-30T07:00:00.000Z' },
];

const NODES_ALL_READY = {
  nodes: [
    { hostname: 'ubuntu-white', label: 'white', state: 'ready', availability: 'active' },
    { hostname: 'ubuntu-red', label: 'red', state: 'ready', availability: 'active' },
    { hostname: 'ubuntu-green', label: 'green', state: 'ready', availability: 'active' },
    { hostname: 'ubuntu-blue', label: 'blue', state: 'ready', availability: 'active' },
  ],
};

const BACKUP_FRESH = {
  configured: true,
  lastBackupAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  rawBytes: 123_456,
};

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <DashboardPage />
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  store.dispatch(vpnApi.util.resetApiState());
  store.dispatch(dashboardApi.util.resetApiState());
});

describe('DashboardPage', () => {
  it('shows VPN up, every node ready and a fresh backup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(ONE_ACTIVE_CONNECTION);
        if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
        if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByText('активно')).toBeTruthy();
    expect(screen.getByText('primary')).toBeTruthy();
    expect(screen.getByText('white')).toBeTruthy();
    expect(screen.getAllByText('в строю')).toHaveLength(4);
    expect(screen.getByText(/час.*назад/)).toBeTruthy();
    expect(await screen.findByText('Всё в порядке')).toBeTruthy();
  });

  it('shows the status of every stored VPN connection, not just the active one', async () => {
    const connections = [
      { id: 1, name: 'primary', serverAddress: '203.0.113.5', isActive: true, createdAt: '2026-09-30T07:00:00.000Z' },
      { id: 2, name: 'backup', serverAddress: '203.0.113.6', isActive: false, createdAt: '2026-09-30T08:00:00.000Z' },
    ];
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requestedUrls.push(request.url);
        if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(connections);
        if (request.url.endsWith('/vpn/connections/2/status')) {
          return jsonResponse({ ...VPN_UP, lastOnline: null });
        }
        if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
        if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);
        return jsonResponse({});
      }),
    );

    renderPage();

    await screen.findByText('primary');
    expect(screen.getByText('backup')).toBeTruthy();
    expect(screen.getByText('активное')).toBeTruthy();
    expect(screen.getByText('активно')).toBeTruthy();
    expect(await screen.findByText('нет связи')).toBeTruthy();
    // The inactive connection is polled without `force` (the cached path) —
    // never with the "Проверить" button's force=1.
    expect(requestedUrls.some((url) => url.endsWith('/vpn/connections/2/status'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes('/vpn/connections/2/status?force=1'))).toBe(false);
  });

  it('shows "Нет подключений" when no VPN connection is stored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/connections')) return jsonResponse([]);
        if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
        if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);
        return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      }),
    );

    renderPage();

    expect(await screen.findByText('Нет подключений')).toBeTruthy();
  });

  it('marks a board missing from the live list as down, not ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(ONE_ACTIVE_CONNECTION);
        if (request.url.endsWith('/dashboard/nodes')) {
          return jsonResponse({
            nodes: [
              { hostname: 'ubuntu-white', label: 'white', state: 'ready', availability: 'active' },
              { hostname: 'ubuntu-red', label: 'red', state: 'down', availability: 'active' },
              { hostname: 'ubuntu-green', label: 'green', state: 'ready', availability: 'active' },
              { hostname: 'ubuntu-blue', label: 'blue', state: 'unknown', availability: null },
            ],
          });
        }
        if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);
        return jsonResponse({});
      }),
    );

    renderPage();

    await screen.findByText('red');
    expect(screen.getByText('недоступен')).toBeTruthy();
    expect(screen.getByText('неизвестно')).toBeTruthy();
    expect(await screen.findByText('Проблем: 1')).toBeTruthy();
  });

  it('shows "Не настроено" when backup status is not set up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(ONE_ACTIVE_CONNECTION);
        if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
        if (request.url.endsWith('/dashboard/backups')) {
          return jsonResponse({ configured: false, lastBackupAt: null, rawBytes: null });
        }
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByText('Не настроено')).toBeTruthy();
  });

  it('flags a stale backup as danger', async () => {
    const staleBackup = {
      configured: true,
      lastBackupAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      rawBytes: 100,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
        if (request.url.endsWith('/vpn/connections')) return jsonResponse(ONE_ACTIVE_CONNECTION);
        if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
        if (request.url.endsWith('/dashboard/backups')) return jsonResponse(staleBackup);
        return jsonResponse({});
      }),
    );

    renderPage();

    const text = await screen.findByText(/дн[яей]+ назад/);
    const label = text.closest('.g-label');
    if (!label) throw new Error('label not found');
    expect(label.className).toMatch(/theme_danger/);
  });
});
