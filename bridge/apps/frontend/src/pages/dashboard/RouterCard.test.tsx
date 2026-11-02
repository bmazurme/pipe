import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi } from '../../store/api';
import { RouterCard } from './RouterCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ROUTER = {
  host: 'asus',
  reportedAt: new Date().toISOString(),
  status: 'ok',
  reasons: [],
  data: {
    reachable: true,
    sshOk: true,
    model: 'RT-AX58U',
    uptimeSec: 400_000,
    wanState: 2,
    wanAux: 0,
    internetOk: true,
    wanIp: '89.207.218.46',
    pingMs: 12.4,
    pingLossPct: 0,
    rxBps: 2_345_000,
    txBps: 640_000,
  },
  reboot: null,
};

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <RouterCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('RouterCard', () => {
  it('shows the verdict, the WAN, the address, the ping, the traffic and the uptime', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([ROUTER])));
    renderCard();

    expect(await screen.findByText('в порядке')).toBeTruthy();
    expect(screen.getByText('RT-AX58U')).toBeTruthy();
    expect(screen.getByText('подключён')).toBeTruthy();
    expect(screen.getByText('интернет есть')).toBeTruthy();
    expect(screen.getByText('89.207.218.46')).toBeTruthy();
    expect(screen.getByText('12 мс')).toBeTruthy();
    expect(screen.getByText('↓ 2,3 Мбит/с')).toBeTruthy();
    expect(screen.getByText('↑ 640 кбит/с')).toBeTruthy();
    expect(screen.getByText('4 дн 15 ч')).toBeTruthy();
    expect(screen.getByText(/командой \/router в Telegram/)).toBeTruthy();
  });

  it('shows the reasons in red and says the internet is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([{ ...ROUTER, status: 'bad', reasons: ['WAN подключён, но интернета нет'], data: { ...ROUTER.data, internetOk: false, pingLossPct: 100 } }]),
      ),
    );
    renderCard();

    expect(await screen.findByText('проблема')).toBeTruthy();
    expect(screen.getByText('WAN подключён, но интернета нет')).toBeTruthy();
    expect(screen.getByText('интернета нет')).toBeTruthy();
    expect(screen.getByText('потери 100 %')).toBeTruthy();
  });

  it('says the cable is out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ ...ROUTER, status: 'bad', reasons: ['Кабель провайдера не подключён к WAN'], data: { ...ROUTER.data, wanAux: 1, wanState: 0, internetOk: null } }])),
    );
    renderCard();

    expect(await screen.findByText('кабель не подключён')).toBeTruthy();
  });

  it('shows the last reboot asked for in Telegram and how it went', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ ...ROUTER, reboot: { status: 'done', at: new Date().toISOString(), result: 'вернулся через 74 с' } }])),
    );
    renderCard();

    expect(await screen.findByText(/выполнена/)).toBeTruthy();
    expect(screen.getByText('вернулся через 74 с')).toBeTruthy();
  });

  it('shows no readings the agent did not give', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ ...ROUTER, status: 'warn', reasons: ['Роутер отвечает, но прочитать его по SSH не удалось (ключ?)'], data: { reachable: true, sshOk: false } }])),
    );
    renderCard();

    expect(await screen.findByText('есть замечания')).toBeTruthy();
    expect(screen.queryByText('Пинг')).toBeNull();
    expect(screen.queryByText('Трафик')).toBeNull();
    expect(screen.queryByText('WAN')).toBeNull();
  });

  it('says how to set it up when nothing has been reported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderCard();

    expect(await screen.findByText(/Роутер ещё не отчитывался/)).toBeTruthy();
  });

  it('shows an error when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});
