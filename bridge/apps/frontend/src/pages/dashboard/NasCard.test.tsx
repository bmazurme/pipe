import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi } from '../../store/api';
import { NasCard } from './NasCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NAS = {
  host: 'MyCloudEX2Ultra',
  reportedAt: new Date().toISOString(),
  status: 'warn',
  reasons: ['Диск sda: секторов в ожидании 2'],
  data: {
    uptimeSec: 200_000,
    backup: { createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(), latest: '20261030T000207Z', snapshots: 3, bytes: 33_581_728 },
    raid: { summary: 'md1 [UU] md0 [UU]', degraded: false, syncing: false },
    volume: { totalBytes: 1_900_000_000_000, usedBytes: 350_000_000_000 },
    disks: [
      { name: 'sda', healthPassed: true, tempC: 44, powerOnHours: 36_848, reallocated: 0, pending: 2 },
      { name: 'sdb', healthPassed: false, tempC: null, powerOnHours: null },
    ],
  },
};

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <NasCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('NasCard', () => {
  it('shows the verdict, the reasons, the copy, the RAID, the volume and each disk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([NAS])));
    renderCard();

    expect(await screen.findByText('есть замечания')).toBeTruthy();
    expect(screen.getByText('MyCloudEX2Ultra')).toBeTruthy();
    expect(screen.getByText('Диск sda: секторов в ожидании 2')).toBeTruthy();
    expect(screen.getByText(/снимков 3/)).toBeTruthy();
    expect(screen.getByText('RAID md1 [UU]')).toBeTruthy();
    expect(screen.getByText('RAID md0 [UU]')).toBeTruthy();
    expect(screen.getByText(/занят на 18 %/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Заполнение тома' }).getAttribute('aria-valuenow')).toBe('18');
    expect(screen.getAllByText(/SMART в порядке/)).toHaveLength(1);
    expect(screen.getByText('SMART не пройден')).toBeTruthy();
    expect(screen.getByText('44 °C')).toBeTruthy();
    expect(screen.getByText('4,2 г. в работе')).toBeTruthy();
  });

  it('marks a RAID array with a missing member and the resync', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ ...NAS, status: 'bad', reasons: ['RAID деградировал (md1 [U_])'], data: { ...NAS.data, raid: { summary: 'md1 [U_] md0 [UU]', degraded: true, syncing: true } } }])));
    renderCard();

    expect(await screen.findByText('RAID md1 [U_]')).toBeTruthy();
    expect(screen.getByText('RAID md0 [UU]')).toBeTruthy();
    expect(screen.getByText('пересборка')).toBeTruthy();
  });

  it('says what a missing report means and how to get one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderCard();

    expect(await screen.findByText(/NAS ещё не присылал отчётов/)).toBeTruthy();
  });

  it('shows a NAS that stopped reporting as a problem, with the reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ ...NAS, status: 'bad', reasons: ['NAS не присылает отчёт 5 ч — выключен или недоступен'] }])));
    renderCard();

    expect(await screen.findByText('проблема')).toBeTruthy();
    expect(screen.getByText(/NAS не присылает отчёт 5 ч/)).toBeTruthy();
  });

  it('shows the error when the list cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});
