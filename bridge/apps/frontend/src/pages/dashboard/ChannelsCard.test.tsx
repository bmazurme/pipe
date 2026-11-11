import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi } from '../../store/api';
import { ChannelsCard } from './ChannelsCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const now = new Date().toISOString();
const cell = (vantage: string, result: string, extra: object = {}) => ({ vantage, result, tcpMs: result === 'ok' ? 20 : null, tlsMs: result === 'ok' ? 45 : null, detail: null, probedAt: now, changedAt: '2026-11-11T10:00:00.000Z', stale: false, ...extra });

const VIEW = {
  status: 'warn',
  reasons: ['Канал IHOR-2: не доходит из: ubuntu-white, bridge — нет ответа на SYN (порт или адрес отфильтрован)'],
  channels: [
    { key: '185.125.231.78:443', name: 'IHOR-1', host: '185.125.231.78', port: 443, sni: 'www.samsung.com', state: 'ok', reason: null, cells: [cell('bridge', 'ok'), cell('cloud', 'ok'), cell('ubuntu-white', 'ok')] },
    { key: '95.81.127.173:443', name: 'IHOR-2', host: '95.81.127.173', port: 443, sni: 'www.samsung.com', state: 'partial', reason: 'x', cells: [cell('bridge', 'tcp_timeout', { detail: 'ETIMEDOUT' }), cell('cloud', 'ok'), cell('ubuntu-white', 'tcp_timeout')] },
    { key: '144.225.67.202:443', name: 'PaperVPN', host: '144.225.67.202', port: 443, sni: 'miro.com', state: 'ok', reason: null, cells: [cell('bridge', 'tls_reset'), cell('cloud', 'ok', { stale: true })] },
  ],
  vantages: [
    { name: 'bridge', lastProbeAt: now, stale: false },
    { name: 'cloud', lastProbeAt: new Date(Date.now() - 20 * 60_000).toISOString(), stale: true },
    { name: 'ubuntu-white', lastProbeAt: now, stale: false },
  ],
};

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ChannelsCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('ChannelsCard', () => {
  it('shows the verdict, the reasons and how many channels are alive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(VIEW)));
    renderCard();

    expect(await screen.findByText('есть замечания')).toBeTruthy();
    expect(screen.getByText(/Канал IHOR-2: не доходит из: ubuntu-white, bridge/)).toBeTruthy();
    expect(screen.getByText('живых каналов: 3 из 3')).toBeTruthy();
  });

  it('is a matrix: a row per channel, a column per vantage point', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(VIEW)));
    renderCard();
    await screen.findByText('IHOR-1');

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);

    expect(headers).toEqual(['Канал', 'bridge', 'cloud', 'ubuntu-white']);
    expect(screen.getByText('185.125.231.78:443 · SNI www.samsung.com')).toBeTruthy();
  });

  it('shows a blocked-from-here channel red from where it fails and green from where it answers — and how it fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(VIEW)));
    renderCard();
    await screen.findByText('IHOR-2');

    const row = rowOf('IHOR-2');
    const cells = within(row).getAllByRole('cell');

    expect(within(cells[0]).getByText('нет SYN-ACK')).toBeTruthy();
    expect(within(cells[1]).getByText('65 мс')).toBeTruthy();
    expect(within(cells[2]).getByText('нет SYN-ACK')).toBeTruthy();
    expect(within(row).getByText('не отовсюду')).toBeTruthy();
  });

  it('says in words what a cell means, in its title', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(VIEW)));
    renderCard();
    await screen.findByText('IHOR-2');

    const failing = within(rowOf('IHOR-2')).getAllByText('нет SYN-ACK')[0];

    expect(failing.closest('[title]')?.getAttribute('title')).toMatch(/нет ответа на SYN.*\(ETIMEDOUT\).*проверено.*результат держится с/);
  });

  it('marks a probe that is too old, and a point that stopped reporting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(VIEW)));
    renderCard();
    await screen.findByText('PaperVPN');

    expect(within(rowOf('PaperVPN')).getByText('устарело')).toBeTruthy();
    expect(within(rowOf('PaperVPN')).getByText('сброс')).toBeTruthy();
    expect(screen.getByText(/cloud: проба/).className).toMatch(/color_warning/);
  });

  it('puts a dash where a vantage point has not probed a channel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...VIEW, channels: [{ ...VIEW.channels[0], cells: [cell('bridge', 'ok')] }] })));
    renderCard();
    await screen.findByText('IHOR-1');

    expect(within(rowOf('IHOR-1')).getAllByText('—')).toHaveLength(2);
  });

  it('counts a bad pool as a problem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...VIEW, status: 'bad', reasons: ['Ни один канал не доходит ни из одной точки'], channels: VIEW.channels.map((channel) => ({ ...channel, state: 'down' })) })));
    renderCard();

    expect(await screen.findByText('проблема')).toBeTruthy();
    expect(screen.getByText('живых каналов: 0 из 3')).toBeTruthy();
  });

  it('says where channels come from when there are none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: 'ok', reasons: [], channels: [], vantages: [] })));
    renderCard();

    expect(await screen.findByText(/Каналов ещё нет/)).toBeTruthy();
  });

  it('says so when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});

describe('ChannelsCard: through the tunnel', () => {
  const E2E_VIEW = {
    ...VIEW,
    status: 'bad',
    reasons: ['Через туннель Claude API: не проходит ни у одного воркера: ошибка запроса (HTTP 403)'],
    e2e: [
      { key: 'e2e:claude', name: 'Claude API', host: 'api.anthropic.com', port: 443, sni: 'api.anthropic.com', state: 'down', reason: 'x', cells: [cell('worker:pi-red', 'error', { tcpMs: null, detail: 'HTTP 403' }), cell('worker:pi-blue', 'tls_timeout', { detail: 'timeout' })] },
      { key: 'e2e:telegram', name: 'Telegram API', host: 'api.telegram.org', port: 443, sni: 'api.telegram.org', state: 'partial', reason: 'y', cells: [cell('worker:pi-red', 'ok', { tcpMs: 480, tlsMs: null }), cell('worker:pi-blue', 'tcp_refused')] },
    ],
    e2eVantages: [
      { name: 'worker:pi-blue', lastProbeAt: now, stale: false },
      { name: 'worker:pi-red', lastProbeAt: now, stale: false },
    ],
  };

  it('shows a second table, a row per service and a column per worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(E2E_VIEW)));
    renderCard();

    expect(await screen.findByText('Сквозная проверка через туннель')).toBeTruthy();
    const tables = screen.getAllByRole('table');

    expect(tables).toHaveLength(2);
    expect(within(tables[1]).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Сервис', 'worker:pi-blue', 'worker:pi-red']);
    expect(within(tables[1]).getByText('api.anthropic.com')).toBeTruthy();
  });

  it('words a request through a tunnel as such: an HTTP status as itself, a dead proxy as the tunnel being down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(E2E_VIEW)));
    renderCard();
    await screen.findByText('Сквозная проверка через туннель');

    const [claude, telegram] = within(screen.getAllByRole('table')[1]).getAllByRole('row').slice(1);

    expect(within(claude).getByText('HTTP 403')).toBeTruthy();
    expect(within(claude).getByText('завис')).toBeTruthy();
    expect(within(telegram).getByText('480 мс')).toBeTruthy();
    expect(within(telegram).getByText('туннель ✗')).toBeTruthy();
    expect(within(claude).getByText('HTTP 403').closest('[title]')?.getAttribute('title')).toMatch(/403 — выход не годится/);
  });

  it('counts the Claude API being down through every tunnel as a problem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(E2E_VIEW)));
    renderCard();

    expect(await screen.findByText('проблема')).toBeTruthy();
    expect(screen.getByText(/Через туннель Claude API: не проходит ни у одного воркера/)).toBeTruthy();
  });

  it('shows no second table when no worker has reported, or when the bridge is older and sends no such field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...VIEW, e2e: [], e2eVantages: [] })));
    renderCard();
    await screen.findByText('IHOR-1');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryByText('Сквозная проверка через туннель')).toBeNull();
  });
});
