import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { improveApi } from '../../store/api';
import { QualityTab } from './QualityTab';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const figures = (over: object = {}) => ({
  opened: 10,
  merged: 8,
  closed: 1,
  open: 1,
  firstGreenRate: 0.75,
  repairsPerMerged: 0.25,
  medianHoursToMerge: 0.5,
  costPerMergedUsd: 1.234,
  withoutCost: 2,
  revertRate: 0.125,
  ...over,
});

const VIEW = {
  days: 90,
  total: figures(),
  byModel: [
    { key: 'haiku', ...figures({ opened: 6, merged: 5, firstGreenRate: 0.8 }) },
    { key: 'sonnet', ...figures({ opened: 4, merged: 3, firstGreenRate: 0.5, medianHoursToMerge: 3.25 }) },
  ],
  byTier: [
    { key: '2', ...figures({ opened: 7 }) },
    { key: 'none', ...figures({ opened: 3 }) },
  ],
};

// The big number of the tile that carries this label.
const tile = (label: string) => (screen.getByText(label).previousElementSibling as HTMLElement).textContent;

const requests: Array<{ method: string; url: string }> = [];

const renderTab = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <QualityTab />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  requests.length = 0;
  store.dispatch(improveApi.util.resetApiState());
});
afterEach(() => vi.unstubAllGlobals());

const stub = (view: unknown, refresh: unknown = { checked: 3, remaining: 0 }) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      requests.push({ method: input.method, url: input.url });

      return input.url.includes('quality/refresh') ? json(refresh) : json(view);
    }),
  );

describe('QualityTab', () => {
  it('shows the headline figures with their units', async () => {
    stub(VIEW);
    renderTab();

    expect(await screen.findByText('10 / 8')).toBeTruthy();
    expect(tile('CI зелёный с 1-го раза')).toBe('75 %');
    expect(tile('Ремонтов CI на влитый PR')).toBe('0.25');
    expect(tile('До слияния (медиана)')).toBe('30 мин');
    expect(tile('Стоимость на влитый PR')).toBe('$1.23');
    expect(tile('Откатов')).toBe('13 %');
  });

  it('splits the figures by model and by tier, saying what a missing tier means', async () => {
    stub(VIEW);
    renderTab();
    await screen.findByText('10 / 8');

    const sonnet = screen.getByText('sonnet').closest('tr') as HTMLElement;

    expect(within(sonnet).getByText('50 %')).toBeTruthy();
    expect(within(sonnet).getByText('3.3 ч')).toBeTruthy();
    expect(screen.getByText('ярус 2')).toBeTruthy();
    expect(screen.getByText('без яруса (модель задана)')).toBeTruthy();
  });

  it('shows a dash, not a zero, for what could not be measured', async () => {
    stub({ ...VIEW, total: figures({ firstGreenRate: null, costPerMergedUsd: null, medianHoursToMerge: null, repairsPerMerged: null, revertRate: null }), byModel: [], byTier: [] });
    renderTab();
    await screen.findByText('10 / 8');

    expect(screen.getAllByText('—').length).toBe(5);
  });

  it('says there is no data yet instead of showing zeros', async () => {
    stub({ ...VIEW, total: figures({ opened: 0, merged: 0, closed: 0, open: 0 }), byModel: [], byTier: [] });
    renderTab();

    expect(await screen.findByText('Пока нет данных')).toBeTruthy();
  });

  it('asks for the period that was chosen', async () => {
    stub(VIEW);
    renderTab();
    await screen.findByText('10 / 8');

    expect(requests.some((request) => request.url.includes('improve/quality?days=90'))).toBe(true);
  });

  it('reads GitHub again on request and says when there is more to read', async () => {
    const user = userEvent.setup();

    stub(VIEW, { checked: 40, remaining: 25 });
    renderTab();
    await screen.findByText('10 / 8');
    await user.click(screen.getByRole('button', { name: 'Обновить из GitHub' }));

    await waitFor(() => expect(requests.some((request) => request.method === 'POST' && request.url.includes('quality/refresh'))).toBe(true));
    expect(await screen.findByText(/Прочитано PR: 40\. Осталось 25/)).toBeTruthy();
  });

  it('says it could not load instead of showing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderTab();

    expect(await screen.findByText(/boom|Не удалось загрузить показатели качества/)).toBeTruthy();
  });
});
