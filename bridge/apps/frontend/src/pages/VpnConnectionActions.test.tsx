import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VpnPage } from './VpnPage';
import { store } from '../store';
import { vpnApi } from '../store/api';

const STATUS = { lastOnline: new Date().toISOString(), upBytes: 1, downBytes: 1, sni: 'x', fingerprint: 'chrome', port: 443 };
const CONNECTIONS = [
  { id: 1, name: 'primary', serverAddress: '203.0.113.5', isActive: true, createdAt: '2026-09-30T07:00:00.000Z' },
  { id: 2, name: 'backup', serverAddress: '203.0.113.6', isActive: false, createdAt: '2026-09-30T08:00:00.000Z' },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: string[];
let failActions: boolean;

beforeEach(() => {
  calls = [];
  failActions = false;
  store.dispatch(vpnApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = request.url;

      if (request.method !== 'GET') calls.push(`${request.method} ${new URL(url).pathname.replace('/api/v1/', '')}`);
      if (request.method !== 'GET' && failActions) return json({ message: 'boom' }, 500);
      if (url.endsWith('/vpn/status')) return json(STATUS);
      if (url.endsWith('/vpn/connections')) return json(CONNECTIONS);
      if (url.endsWith('/connection-link')) return json({ link: 'vless://abc#pipe' });

      return request.method === 'DELETE' ? new Response(null, { status: 204 }) : json({});
    }),
  );
});

afterEach(() => vi.useRealTimers());

const renderPage = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <VpnPage />
      </ThemeProvider>
    </Provider>,
  );

describe('VPN connection actions', () => {
  it('does not delete on the first click, and deletes on the confirming second one', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('backup');

    await user.click(screen.getByLabelText('Удалить подключение: backup'));

    expect(calls).toEqual([]);
    expect(screen.getByText('Удалить?')).toBeTruthy();

    await user.click(screen.getByLabelText('Подтвердить удаление подключения: backup'));

    await waitFor(() => expect(calls).toContain('DELETE vpn/connections/2'));
  });

  it('disarms the delete button if it is not confirmed in time', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('backup');

    await user.click(screen.getByLabelText('Удалить подключение: backup'));
    expect(screen.getByLabelText('Подтвердить удаление подключения: backup')).toBeTruthy();

    await waitFor(() => expect(screen.getByLabelText('Удалить подключение: backup')).toBeTruthy(), { timeout: 6000 });
    expect(calls).toEqual([]);
  }, 10000);

  it('tells the user when deleting fails, instead of nothing', async () => {
    const user = userEvent.setup();
    failActions = true;
    renderPage();
    await screen.findByText('backup');

    await user.click(screen.getByLabelText('Удалить подключение: backup'));
    await user.click(screen.getByLabelText('Подтвердить удаление подключения: backup'));

    expect(await screen.findByText('Не удалось удалить подключение')).toBeTruthy();
  });

  it('tells the user when making a connection active fails', async () => {
    const user = userEvent.setup();
    failActions = true;
    renderPage();
    const backupRow = (await screen.findByText('backup')).closest('li') as HTMLElement;

    await user.click(within(backupRow).getByText('Сделать активным'));

    expect(await screen.findByText('Не удалось сделать подключение активным')).toBeTruthy();
  });

  it('labels the share-link field', async () => {
    const user = userEvent.setup();
    renderPage();
    const backupRow = (await screen.findByText('backup')).closest('li') as HTMLElement;

    await user.click(within(backupRow).getByText('Ссылка'));

    expect(await screen.findByLabelText('Ссылка подключения backup')).toBeTruthy();
  });
});
