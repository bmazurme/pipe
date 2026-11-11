import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi } from '../../store/api';
import { CloudCard } from './CloudCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const CLOUD = {
  host: 'yc-vm',
  reportedAt: new Date().toISOString(),
  status: 'bad',
  reasons: ['Сервис notes_client: запущено 0 из 1'],
  data: {
    uptimeSec: 2 * 86_400 + 3 * 3600,
    cpus: 2,
    load5: 0.42,
    memory: { totalMb: 1963, availableMb: 606, swapTotalMb: 2048, swapUsedMb: 100 },
    disk: { totalBytes: 31_138_512_896, usedBytes: 20_401_094_656 },
    services: [
      { name: 'bridge_backend', desired: 1, running: 1, health: 'healthy', restarts24h: 0, memMb: 118, critical: true },
      { name: 'notes_client', desired: 1, running: 0, health: 'none', critical: false },
      { name: 'places_backend', desired: 1, running: 1, health: 'unhealthy', restarts24h: 4, critical: true },
      { name: 'old_thing', desired: 0, running: 0, critical: false },
    ],
    probes: [
      { name: 'https://api.bridge.ntlstl.dev/api/v1/health', ok: true, httpCode: 200, ms: 38, critical: true },
      { name: 'https://notes.ntlstl.dev', ok: false, httpCode: 502, critical: false },
    ],
    leader: { site: 'vm', epoch: 3 },
    replication: { connected: true, lagSec: 2.4 },
    backups: [
      { name: 'bridge', ageHours: 3.1 },
      { name: 'notes', ageHours: 30 },
      { name: 'places', ageHours: null },
    ],
    certs: [{ name: 'api.bridge.ntlstl.dev', days: 9 }],
    version: 'e676c710aabbccdd',
  },
};

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <CloudCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('CloudCard', () => {
  it('shows the verdict, who leads, the reasons, the meters and the facts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([CLOUD])));
    renderCard();

    expect(await screen.findByText('проблема')).toBeTruthy();
    expect(screen.getByText('yc-vm')).toBeTruthy();
    expect(screen.getByText('лидер: vm · эпоха 3')).toBeTruthy();
    expect(screen.getByText('версия e676c710')).toBeTruthy();
    expect(screen.getByText(/работает 2 дн 3 ч/)).toBeTruthy();
    // The reason appears in the list under the header (and the service has its own row).
    expect(screen.getByText('Сервис notes_client: запущено 0 из 1')).toBeTruthy();
    expect(screen.getByText('доступно 606 МБ из 1963 МБ')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Занятая память' }).getAttribute('aria-valuenow')).toBe('69');
    expect(screen.getByRole('progressbar', { name: 'Занятый swap' }).getAttribute('aria-valuenow')).toBe('5');
    expect(screen.getByRole('progressbar', { name: 'Заполнение диска' }).getAttribute('aria-valuenow')).toBe('66');
    expect(screen.getByText('0.42 за 5 мин на 2 ядр.')).toBeTruthy();
    expect(screen.getByText('отстаёт на 2 с')).toBeTruthy();
    expect(screen.getByText('bridge: 3 ч')).toBeTruthy();
    expect(screen.getByText('notes: 30 ч')).toBeTruthy();
    expect(screen.getByText('places: нет')).toBeTruthy();
    expect(screen.getByText('api.bridge.ntlstl.dev: 9 дн.')).toBeTruthy();
  });

  it('lists the services with their state and the probes with their codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([CLOUD])));
    renderCard();

    await screen.findByText('Сервисы');
    const services = screen.getByText('bridge_backend').closest('dl') as HTMLElement;

    expect(within(services).getByText('118 МБ')).toBeTruthy();
    expect(within(services).getByText('0 из 1')).toBeTruthy();
    expect(within(services).getByText('health не проходит')).toBeTruthy();
    expect(within(services).getByText('перезапусков за сутки: 4')).toBeTruthy();
    expect(within(services).getByText('выключен')).toBeTruthy();
    // notes_client and the one scaled to zero are not critical.
    expect(within(services).getAllByText('не критичный')).toHaveLength(2);
    expect(screen.getByText('api.bridge.ntlstl.dev/api/v1/health: 200 · 38 мс')).toBeTruthy();
    expect(screen.getByText('notes.ntlstl.dev: код 502')).toBeTruthy();
  });

  it('marks a replica that is not connected, and a VM without swap', async () => {
    const data = { ...CLOUD.data, memory: { ...CLOUD.data.memory, swapTotalMb: 0, swapUsedMb: 0 }, replication: { connected: false, lagSec: null } };
    vi.stubGlobal('fetch', vi.fn(async () => json([{ ...CLOUD, data }])));
    renderCard();

    expect(await screen.findByText('не подключена')).toBeTruthy();
    expect(screen.getByText('не настроен')).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: 'Занятый swap' })).toBeNull();
  });

  it('says what to do when the VM has never reported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderCard();

    expect(await screen.findByText(/VM ещё не присылала отчётов/)).toBeTruthy();
  });

  it('says so when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});
