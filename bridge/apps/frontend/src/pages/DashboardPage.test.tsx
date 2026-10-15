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
        if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
        if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByText('активно')).toBeTruthy();
    expect(screen.getByText('white')).toBeTruthy();
    expect(screen.getAllByText('в строю')).toHaveLength(4);
    expect(screen.getByText(/час.*назад/)).toBeTruthy();
  });

  it('shows VPN down when there is no recent handshake', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse({ ...VPN_UP, lastOnline: null });
        if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
        if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);
        return jsonResponse({});
      }),
    );

    renderPage();

    expect(await screen.findByText('нет связи')).toBeTruthy();
  });

  it('marks a board missing from the live list as down, not ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
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
  });

  it('shows "Не настроено" when backup status is not set up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
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
