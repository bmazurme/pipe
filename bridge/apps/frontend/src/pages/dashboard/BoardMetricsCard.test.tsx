import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi } from '../../store/api';
import { BoardMetricsCard } from './BoardMetricsCard';
import { fanText, segments, seriesStats } from './tempSeries';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const now = Date.now();
const series = (soc: Array<number | null>) => soc.map((value, i) => ({ t: new Date(now - (soc.length - i) * 300_000).toISOString(), soc: value, nvme: value === null ? null : value - 10 }));

const RED = {
  host: 'ubuntu-red',
  at: new Date(now - 60_000).toISOString(),
  status: 'warn',
  reasons: ['Процессор 68 °C'],
  data: { socTempC: 68, throttled: 0, fanRpm: 4200, nvmeTempC: 41, load1: 1.37, memAvailPct: 75, memTotalMb: 7812, diskUsedPct: 30, uptimeSec: 200_000 },
  series: series([60, 64, 68]),
};
const BLUE = {
  host: 'ubuntu-blue',
  at: new Date(now - 3 * 3600_000).toISOString(),
  status: 'bad',
  reasons: ['Нет данных 3 ч — плата выключена, зависла или без связи с мостом'],
  data: { socTempC: 50 },
  series: [],
};

let requested: string[] = [];

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <BoardMetricsCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  requested = [];
  store.dispatch(dashboardApi.util.resetApiState());
});
afterEach(() => vi.unstubAllGlobals());

describe('BoardMetricsCard', () => {
  it('shows each board with its temperature, the reasons, the other vital signs and a graph', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requested.push(new URL(request.url).search);

        return json([RED, BLUE]);
      }),
    );
    renderCard();

    expect(await screen.findByText('68 °C')).toBeTruthy();
    expect(screen.getByText('red')).toBeTruthy();
    expect(screen.getByText('Процессор 68 °C')).toBeTruthy();
    expect(screen.getByText('NVMe 41 °C')).toBeTruthy();
    expect(screen.getByText('кулер 4200 об/мин')).toBeTruthy();
    expect(screen.getByText('нагрузка 1.37')).toBeTruthy();
    expect(screen.getByText('память свободна 75 %')).toBeTruthy();
    expect(screen.getByText('диск 30 %')).toBeTruthy();
    expect(screen.getByText(/работает 2 дн 7 ч/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Температура red за 24 часа' })).toBeTruthy();
    // a board that stopped sending is a problem, not a number from three hours ago
    expect(screen.getByText('проблема')).toBeTruthy();
    expect(screen.getByText(/Нет данных 3 ч/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Температура blue за 24 часа: графика пока нет' })).toBeTruthy();
    expect(requested[0]).toBe('?hours=24');
  });

  it('asks for the week when the window is switched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requested.push(new URL(request.url).search);

        return json([RED]);
      }),
    );
    const user = userEvent.setup();
    renderCard();

    await screen.findByText('68 °C');
    await user.click(screen.getByText('7 дней'));

    await waitFor(() => expect(requested).toContain('?hours=168'));
    expect(await screen.findByRole('img', { name: 'Температура red за 7 дней' })).toBeTruthy();
  });

  it('explains how the first readings arrive when there are none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderCard();

    expect(await screen.findByText(/Данных пока нет/)).toBeTruthy();
  });

  it('shows the error when the readings cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});

describe('TempChart segments', () => {
  const x = (t: number) => t;
  const y = (v: number) => v;
  const point = (t: number, soc: number | null) => ({ t: new Date(t).toISOString(), soc, nvme: null });

  it('breaks the line where a reading is missing instead of drawing across the gap', () => {
    const out = segments([point(1000, 50), point(2000, 52), point(3000, null), point(4000, 55)], 'soc', x, y);

    expect(out.map((seg) => seg.map((p) => p.y))).toEqual([[50, 52], [55]]);
  });

  it('is empty when nothing was read', () => {
    expect(segments([point(1000, null)], 'soc', x, y)).toEqual([]);
    expect(segments([], 'nvme', x, y)).toEqual([]);
  });
});

describe('seriesStats and fanText', () => {
  const at = (soc: number | null, nvme: number | null = null) => ({ t: '2026-10-30T12:00:00Z', soc, nvme });

  it('frames the data with a margin and never less than twelve degrees, so a flat line does not look like a climb', () => {
    const flat = seriesStats([at(48), at(49), at(48)]);

    expect(flat).toMatchObject({ socMin: 48, socMax: 49, nvmeMin: null });
    expect(flat!.hi - flat!.lo).toBeCloseTo(12);
    expect((flat!.lo + flat!.hi) / 2).toBeCloseTo(48.5);

    const wide = seriesStats([at(40, 30), at(70, 35)]);

    expect(wide!.hi - wide!.lo).toBeCloseTo(52);
    expect(wide).toMatchObject({ socMin: 40, socMax: 70, nvmeMin: 30, nvmeMax: 35 });
  });

  it('has nothing to frame without a single reading', () => {
    expect(seriesStats([at(null), at(null)])).toBeNull();
    expect(seriesStats([])).toBeNull();
  });

  it('calls an idle fan on a cool board "off", a stopped one on a warm board a warning, and prints a turning one', () => {
    expect(fanText(0, 48)).toEqual({ text: 'кулер выкл', warn: false });
    expect(fanText(0, undefined)).toEqual({ text: 'кулер выкл', warn: false });
    expect(fanText(0, 66)).toEqual({ text: 'кулер стоит', warn: true });
    expect(fanText(4585, 66)).toEqual({ text: 'кулер 4585 об/мин', warn: false });
  });
});
