import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { vpnApi } from '../../store/api';
import { BridgeTunnelCard } from './BridgeTunnelCard';

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const check = (over: Record<string, unknown> = {}) => ({
  key: 'telegram',
  label: 'Telegram API',
  ok: true,
  ms: 312,
  error: null,
  at: iso(0),
  ...over,
});

let answer: unknown;

beforeEach(() => {
  answer = {};
  store.dispatch(vpnApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <BridgeTunnelCard />
      </ThemeProvider>
    </Provider>,
  );

describe('BridgeTunnelCard', () => {
  it('says Telegram and GitHub go through the active connection, with each check', async () => {
    answer = { mode: 'on', reason: null, links: 2, inUse: true, since: iso(-120_000), checks: [check(), check({ key: 'github', label: 'GitHub API', ms: 410 })] };
    renderCard();

    expect(await screen.findByText('работает')).toBeTruthy();
    expect(screen.getByText(/Telegram и GitHub идут через активное подключение \(ссылок: 2\)/)).toBeTruthy();
    expect(screen.getByText('Telegram API')).toBeTruthy();
    expect(screen.getByText(/312 мс/)).toBeTruthy();
  });

  it('warns when the tunnel is up but Telegram does not answer through it, and shows why', async () => {
    answer = {
      mode: 'on',
      reason: null,
      links: 1,
      inUse: false,
      since: iso(-60_000),
      checks: [check({ ok: false, ms: null, error: 'ERR_TLS_CERT_ALTNAME_INVALID' })],
    };
    renderCard();

    expect(await screen.findByText('не используется')).toBeTruthy();
    expect(screen.getByText(/Telegram через него не отвечает/)).toBeTruthy();
    expect(screen.getByText(/ERR_TLS_CERT_ALTNAME_INVALID/)).toBeTruthy();
  });

  it('says so when nothing is active, and when the tunnel is off', async () => {
    answer = { mode: 'on', reason: null, links: 0, inUse: false, since: null, checks: [] };
    const first = renderCard();

    expect(await screen.findByText(/Нет активного подключения/)).toBeTruthy();
    first.unmount();

    store.dispatch(vpnApi.util.resetApiState());
    answer = { mode: 'off', reason: 'xray не установлен в этом образе', links: 0, inUse: false, since: null, checks: [] };
    renderCard();

    expect(await screen.findByText('выключен')).toBeTruthy();
    expect(screen.getByText(/xray не установлен в этом образе/)).toBeTruthy();
  });

  it('shows nothing for an older bridge without the route', async () => {
    answer = { message: 'Not Found' };
    const { container } = renderCard();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.textContent).toBe('');
  });

  it('says when Telegram is down and whether another channel will carry the alerts', async () => {
    answer = {
      mode: 'on',
      reason: null,
      links: 1,
      inUse: false,
      since: null,
      checks: [],
      telegram: { down: true, since: iso(-300_000), error: 'HTTP 504' },
      fallback: { configured: false, channels: [] },
    };
    const first = renderCard();

    expect(await screen.findByText(/^Telegram недоступен с/)).toBeTruthy();
    expect(screen.getByText(/HTTP 504/)).toBeTruthy();
    expect(screen.getByText(/Запасной канал не настроен/)).toBeTruthy();
    first.unmount();

    store.dispatch(vpnApi.util.resetApiState());
    answer = {
      mode: 'on',
      reason: null,
      links: 1,
      inUse: true,
      since: null,
      checks: [],
      telegram: { down: false, since: null, error: null },
      fallback: { configured: true, channels: [{ name: 'webhook', target: 'ntfy.sh' }, { name: 'email', target: 'me@example.org' }] },
    };
    renderCard();

    expect(await screen.findByText(/Запасной канал для срочных алертов: webhook \(ntfy\.sh\), почта \(me@example\.org\)/)).toBeTruthy();
    expect(screen.queryByText(/^Telegram недоступен с/)).toBeNull();
  });
});
