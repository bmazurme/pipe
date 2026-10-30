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
    expect(screen.getByText('Задайте BACKUP_S3_* на backend')).toBeTruthy();
  });

  describe('request errors', () => {
    function stubWithFailure(failing: string) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) => {
          if (request.url.endsWith(failing)) {
            return new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } });
          }
          if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
          if (request.url.endsWith('/vpn/connections')) return jsonResponse(ONE_ACTIVE_CONNECTION);
          if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
          if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);
          return jsonResponse({});
        }),
      );
    }

    it('shows an error and counts an issue when /dashboard/nodes fails', async () => {
      stubWithFailure('/dashboard/nodes');
      renderPage();

      expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
      expect(await screen.findByText('Проблем: 1')).toBeTruthy();
      expect(screen.queryByText('Всё в порядке')).toBeNull();
    });

    it('never shows "Нет подключений" when the VPN connections list fails', async () => {
      stubWithFailure('/vpn/connections');
      renderPage();

      expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
      expect(screen.queryByText('Нет подключений')).toBeNull();
      expect(await screen.findByText('Проблем: 1')).toBeTruthy();
    });

    it('never shows "Не настроено" when /dashboard/backups fails', async () => {
      stubWithFailure('/dashboard/backups');
      renderPage();

      expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
      expect(screen.queryByText('Не настроено')).toBeNull();
      expect(screen.queryByText('Задайте BACKUP_S3_* на backend')).toBeNull();
      expect(await screen.findByText('Проблем: 1')).toBeTruthy();
    });
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

  describe('the header and the list of what is wrong, from every tile', () => {
    const BOARD_BAD = { host: 'ubuntu-green', at: new Date().toISOString(), status: 'bad', reasons: ['Нет данных 12 мин — плата выключена, зависла или без связи с мостом'], data: {}, series: [] };
    const BOARD_WARM = { host: 'ubuntu-blue', at: new Date().toISOString(), status: 'warn', reasons: ['Процессор 66 °C'], data: { socTempC: 66 }, series: [] };
    const NAS_WARN = { host: 'MyCloudEX2Ultra', reportedAt: new Date().toISOString(), status: 'warn', reasons: ['Копия бэкапа устарела: 27 ч'], data: { uptimeSec: 1, backup: { snapshots: 1, bytes: 1 }, raid: { summary: 'md1 [UU]', degraded: false, syncing: false }, volume: { totalBytes: 1, usedBytes: 1 }, disks: [] } };
    const ROLLED_BACK = { sha: '9781a0d'.padEnd(40, 'a'), previousSha: null, result: 'rolled_back', detail: null, prNumbers: [41, 42], at: new Date().toISOString() };

    const serve = (extra: Record<string, unknown>) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) => {
          if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
          if (request.url.endsWith('/vpn/connections')) return jsonResponse(ONE_ACTIVE_CONNECTION);
          if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
          if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);
          for (const [path, body] of Object.entries(extra)) if (request.url.includes(path)) return jsonResponse(body);

          return jsonResponse([]);
        }),
      );

    it('counts a dead board and a rolled back release as problems and lists them, worst first, with the remarks after', async () => {
      serve({ '/dashboard/board-metrics': [BOARD_WARM, BOARD_BAD], '/dashboard/nas': [NAS_WARN], '/dashboard/deploys': [ROLLED_BACK] });
      renderPage();

      expect(await screen.findByText('Проблем: 2')).toBeTruthy();
      expect(await screen.findByText('Что требует внимания')).toBeTruthy();
      const lines = screen.getAllByRole('listitem').map((li) => li.textContent);

      expect(lines).toEqual([
        'Плата green: Нет данных 12 мин — плата выключена, зависла или без связи с мостом',
        'Релиз 9781a0d (#41, #42) откатился — автоматика на паузе',
        'Плата blue: Процессор 66 °C',
        'NAS: Копия бэкапа устарела: 27 ч',
      ]);
    });

    it('says "Замечаний" when there are only remarks, and "Всё в порядке" with nothing to say', async () => {
      serve({ '/dashboard/board-metrics': [BOARD_WARM], '/dashboard/nas': [NAS_WARN] });
      renderPage();

      expect(await screen.findByText('Замечаний: 2')).toBeTruthy();
      expect(screen.getByText('Замечания')).toBeTruthy();
    });

    it('does not count a tile that failed to load as a problem of its own (the tile says so itself)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) => {
          if (request.url.endsWith('/vpn/status')) return jsonResponse(VPN_UP);
          if (request.url.endsWith('/vpn/connections')) return jsonResponse(ONE_ACTIVE_CONNECTION);
          if (request.url.endsWith('/dashboard/nodes')) return jsonResponse(NODES_ALL_READY);
          if (request.url.endsWith('/dashboard/backups')) return jsonResponse(BACKUP_FRESH);

          return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        }),
      );
      renderPage();

      expect(await screen.findByText('Всё в порядке')).toBeTruthy();
    });
  });
});
