import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi } from '../../store/api';
import { UpsCard } from './UpsCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const UPS = {
  host: 'ubuntu-blue',
  reportedAt: new Date().toISOString(),
  status: 'ok',
  reasons: [],
  onBattery: false,
  data: {
    status: 'OL CHRG',
    model: 'UT1050EG',
    chargePct: 90,
    runtimeSec: 4539,
    loadPct: 9,
    inputVolts: 231,
    batteryVolts: 28.2,
    nominalWatts: 630,
    testResult: 'No test initiated',
  },
};

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <UpsCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('UpsCard', () => {
  it('shows the verdict, the model, the board, the state, the charge with the time left, the load in watts and the input', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([UPS])));
    renderCard();

    expect(await screen.findByText('в порядке')).toBeTruthy();
    expect(screen.getByText('UT1050EG')).toBeTruthy();
    expect(screen.getByText(/подключён к ubuntu-blue/)).toBeTruthy();
    expect(screen.getByText('от сети')).toBeTruthy();
    expect(screen.getByText('заряжается')).toBeTruthy();
    expect(screen.getByText(/90 % · хватит примерно на 1 ч 16 мин/)).toBeTruthy();
    expect(screen.getByText(/9 % · около 57 Вт из 630/)).toBeTruthy();
    expect(screen.getByText('231 В')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Заряд батареи' }).getAttribute('aria-valuenow')).toBe('90');
  });

  it('shows the reasons in red when the UPS carries the load from its battery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([
          {
            ...UPS,
            status: 'bad',
            onBattery: true,
            reasons: ['Питание пропало, ИБП работает от батареи, примерно 30 мин до отключения'],
            data: { ...UPS.data, status: 'OB DISCHRG' },
          },
        ]),
      ),
    );
    renderCard();

    expect(await screen.findByText('проблема')).toBeTruthy();
    expect(screen.getByText(/Питание пропало/)).toBeTruthy();
    expect(screen.getByText('от батареи')).toBeTruthy();
    expect(screen.getByText('разряжается')).toBeTruthy();
  });

  it('says how to set it up when nothing has been reported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderCard();

    expect(await screen.findByText(/ИБП ещё не присылал данных/)).toBeTruthy();
  });

  it('shows an error when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});
