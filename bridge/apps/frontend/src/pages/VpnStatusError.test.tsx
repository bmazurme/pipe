import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VpnPage } from './VpnPage';
import { store } from '../store';
import { vpnApi } from '../store/api';

const CONNECTIONS = [
  { id: 1, name: 'primary', serverAddress: '203.0.113.5', isActive: true, createdAt: '2026-09-30T07:00:00.000Z' },
  { id: 2, name: 'backup', serverAddress: '203.0.113.6', isActive: false, createdAt: '2026-09-30T08:00:00.000Z' },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let statusResponse: () => Response;
let checkResponse: () => Response;

beforeEach(() => {
  store.dispatch(vpnApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = request.url;

      if (url.endsWith('/vpn/status')) return statusResponse();
      if (url.endsWith('/vpn/connections/2/status')) return checkResponse();
      if (url.endsWith('/vpn/connections')) return json(CONNECTIONS);

      return json({});
    }),
  );
});

const renderPage = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <VpnPage />
      </ThemeProvider>
    </Provider>,
  );

describe('VPN status failures show their reason', () => {
  it('says the panel rejected the token, instead of a bare failure', async () => {
    statusResponse = () => json({ message: 'VPN panel "primary" rejected the API token (401) — check the token saved for this connection' }, 502);
    renderPage();

    expect(await screen.findByText(/Не удалось получить статус — VPN panel "primary" rejected the API token/)).toBeTruthy();
  });

  it('says the server pushed back when throttled', async () => {
    statusResponse = () => json({ message: 'ThrottlerException: Too Many Requests' }, 429);
    renderPage();

    expect(await screen.findByText(/слишком много запросов/)).toBeTruthy();
  });

  it('says an expired session is an expired session', async () => {
    statusResponse = () => json({ message: 'Unauthorized' }, 401);
    renderPage();

    expect((await screen.findAllByText(/Не удалось получить статус/)).length).toBeGreaterThan(0);
  });

  it('does not claim "no active connection" for a failure that is something else', async () => {
    statusResponse = () => json({ message: 'VPN panel "primary" is unreachable from bridge (ECONNREFUSED)' }, 502);
    renderPage();

    await screen.findByText(/unreachable from bridge \(ECONNREFUSED\)/);

    expect(screen.queryByText('Нет активного VPN-подключения')).toBeNull();
  });

  it('still says there is no active connection when that is the cause', async () => {
    // A typed 404 now (not a 500 whose text is matched).
    statusResponse = () => json({ message: 'No active VPN connection is configured — add one and select it first' }, 404);
    renderPage();

    expect(await screen.findByText('Нет активного VPN-подключения')).toBeTruthy();
  });

  it('shows the reason for a failed manual check on a connection too', async () => {
    const user = userEvent.setup();
    statusResponse = () => json({ obj: null }, 200);
    checkResponse = () => json({ message: 'VPN panel "backup" did not respond within 10000ms (/panel/api/inbounds/list)' }, 502);
    renderPage();
    const row = (await screen.findByText('backup')).closest('li') as HTMLElement;

    await user.click(within(row).getByText('Проверить'));

    expect(await screen.findByText(/did not respond within 10000ms/)).toBeTruthy();
  });
});
