import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { improveApi, labApi, type ModelCards as ModelCardsData, type ModelCell } from '../../store/api';
import { ModelCards } from './ModelCards';
import { byTier, minutes, percent, usd } from './modelCardsFacts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const cell = (over: Partial<ModelCell> = {}): ModelCell => ({
  model: 'haiku',
  tier: 2,
  prs: 6,
  merged: 6,
  closed: 0,
  open: 0,
  stepUps: 0,
  closeRate: 1,
  samples: 6,
  firstGreenRate: 0.83,
  repairsPerMerged: 0.2,
  revertRate: 0,
  medianWorkMinutes: 7,
  costPerMergedUsd: 0.25,
  verdict: 'solid',
  ...over,
});

const RULES = { minSamples: 5, solidCloseRate: 0.8, solidFirstGreenRate: 0.6, maxRevertRate: 0.15, cheaperRatio: 0.7 };

const CARDS: ModelCardsData = {
  days: 90,
  cells: [cell(), cell({ model: 'sonnet', tier: 3, closeRate: 0.9, costPerMergedUsd: 1.4, medianWorkMinutes: null }), cell({ tier: 3, stepUps: 4, closeRate: 0.4, verdict: 'weak', merged: 4, prs: 6, samples: 10 })],
  advice: [
    { tier: 2, current: 'haiku', status: 'keep', reason: '«haiku» закрывает 100 % из 6, $0.25 за влитую — менять не на что' },
    { tier: 3, current: 'haiku', status: 'switch', suggested: 'sonnet', reason: '«haiku» закрыл сам 40 % из 10 (шаг вверх 4)' },
    { tier: 4, current: 'opus', status: 'no-data', reason: 'Ярус ещё не набрал ни одной завершённой задачи' },
  ],
  rules: RULES,
};

const SETTINGS = { tierModels: { '1': 'haiku', '2': 'haiku', '3': 'haiku', '4': 'opus' }, rules: [] };

function stub(cards: unknown = CARDS) {
  const puts: unknown[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      if (input.url.includes('router/settings')) {
        if (input.method === 'PUT') {
          puts.push(await input.json());

          return json(puts[puts.length - 1]);
        }

        return json(SETTINGS);
      }

      return json(cards);
    }),
  );

  return puts;
}

const renderCards = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ModelCards days={90} />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => {
  store.dispatch(improveApi.util.resetApiState());
  store.dispatch(labApi.util.resetApiState());
});
afterEach(() => vi.unstubAllGlobals());

describe('modelCardsFacts', () => {
  it('formats what is known and shows a dash for what is not', () => {
    expect(percent(0.833)).toBe('83 %');
    expect(percent(null)).toBe('—');
    expect(usd(1.4)).toBe('$1.40');
    expect(usd(null)).toBe('—');
    expect(minutes(7.2)).toBe('7 мин');
    expect(minutes(0.4)).toBe('< 1 мин');
    expect(minutes(null)).toBe('—');
  });

  it('groups the cards by tier in order', () => {
    expect(byTier(CARDS.cells).map((g) => [g.tier, g.cells.length])).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });
});

describe('ModelCards', () => {
  it('shows a card per model and tier with its verdict, and the advice for each tier of the router table', async () => {
    stub();
    renderCards();

    expect(await screen.findByText('ярус 2 · haiku')).toBeTruthy();
    expect(screen.getByText('ярус 3 · sonnet')).toBeTruthy();
    expect(screen.getAllByText('надёжно').length).toBeGreaterThan(0);
    expect(screen.getByText('слабо')).toBeTruthy();
    expect(screen.getByText(/«haiku» закрывает 100 % из 6/)).toBeTruthy();
    expect(screen.getByText('ярус 4: нет задач')).toBeTruthy();
  });

  it('offers to put the suggested model on a tier only where the data says switch, and writes just that tier to the router settings', async () => {
    const puts = stub();
    const user = userEvent.setup();

    renderCards();

    const button = await screen.findByRole('button', { name: /Поставить «sonnet» на ярус 3/ });

    expect(screen.getAllByRole('button')).toHaveLength(1);

    await user.click(button);

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ tierModels: { '1': 'haiku', '2': 'haiku', '3': 'sonnet', '4': 'opus' }, rules: [] });
  });

  it('renders nothing when there are no finished pull requests yet', async () => {
    stub({ ...CARDS, cells: [], advice: [] });
    renderCards();

    await waitFor(() => expect(screen.queryByTestId('model-cards')).toBeNull());
  });

  it('renders nothing for an answer of the wrong shape, and says so when the request fails', async () => {
    stub({ days: 90 });
    const { unmount } = renderCards();

    await waitFor(() => expect(screen.queryByTestId('model-cards')).toBeNull());
    unmount();

    store.dispatch(improveApi.util.resetApiState());
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCards();

    expect(await screen.findByText(/boom|Не удалось загрузить карточки моделей/)).toBeTruthy();
  });
});
