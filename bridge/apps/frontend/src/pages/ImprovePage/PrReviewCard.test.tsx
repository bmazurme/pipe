import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { improveApi, type PrReview } from '../../store/api';
import { PrReviewCard } from './PrReviewCard';
import { filesWord, runLine } from './prReviewFacts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const REVIEW: PrReview = {
  number: 12,
  title: 'Add the thing',
  url: 'https://github.com/o/r/pull/12',
  risk: { level: 'medium', text: 'Риск: средний (код)' },
  diff: {
    files: 3,
    additions: 123,
    deletions: 3,
    areas: [
      { name: 'bridge backend', files: 2 },
      { name: 'тесты', files: 1 },
    ],
    largest: [{ path: 'bridge/apps/backend/src/a.ts', additions: 80, deletions: 2 }],
  },
  attention: ['Код изменён, а тестов среди файлов нет'],
  checked: ['CI зелёный', 'защищённые пути не затронуты'],
  notChecked: ['Diff человеком не читался — это и есть ваше ревью', 'Воркер не проверял: e2e'],
  run: { model: 'sonnet', tier: 3, trigger: 'auto', attempts: 2, ciRepairs: 1, escalated: false, workMinutes: 7, costUsd: 1.4 },
  improveUrl: 'https://bridge.example/improve',
};

let respond: () => Response;
let requested: string[];

beforeEach(() => {
  requested = [];
  respond = () => json(REVIEW);
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requested.push(new URL(request.url).pathname.replace('/api/v1/', ''));

      return respond();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <PrReviewCard number={12} />
      </ThemeProvider>
    </Provider>,
  );

describe('prReviewFacts', () => {
  it('declines "файл" and writes the run line without what is not known', () => {
    expect([1, 2, 5, 11, 21, 24].map(filesWord)).toEqual(['файл', 'файла', 'файлов', 'файлов', 'файл', 'файла']);
    expect(runLine(REVIEW.run as NonNullable<PrReview['run']>)).toBe('sonnet, ярус 3 · 7 мин · $1.40 · ремонтов CI: 1 · запуск: auto');
    expect(runLine({ ...(REVIEW.run as NonNullable<PrReview['run']>), tier: null, workMinutes: null, costUsd: null, ciRepairs: 0, trigger: 'manual', escalated: true })).toBe(
      'sonnet · после шага вверх',
    );
  });
});

describe('PrReviewCard', () => {
  it('shows the change, its risk, what was and was not checked and the run', async () => {
    renderCard();

    expect(await screen.findByText('Риск: средний (код)')).toBeTruthy();
    expect(screen.getByText('3 файла, +123 −3')).toBeTruthy();
    expect(screen.getByText('bridge backend 2, тесты 1')).toBeTruthy();
    expect(screen.getByText(/Крупнее всего: bridge\/apps\/backend\/src\/a\.ts \(\+80 −2\)/)).toBeTruthy();
    expect(screen.getByText('⚠️ Код изменён, а тестов среди файлов нет')).toBeTruthy();
    expect(screen.getByText('✓ CI зелёный')).toBeTruthy();
    expect(screen.getByText('— Diff человеком не читался — это и есть ваше ревью')).toBeTruthy();
    expect(screen.getByText('— Воркер не проверял: e2e')).toBeTruthy();
    expect(screen.getByText(/Запуск: sonnet, ярус 3 · 7 мин · \$1\.40/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'метрики' }).getAttribute('href')).toBe('https://bridge.example/improve');
    expect(requested).toEqual(['improve/prs/12/review']);
  });

  it('leaves out the warnings, the run and the metrics link when there are none', async () => {
    respond = () => json({ ...REVIEW, attention: [], run: null, improveUrl: null, checked: [] });
    renderCard();

    expect(await screen.findByText('Риск: средний (код)')).toBeTruthy();
    expect(screen.queryByLabelText('Обратите внимание')).toBeNull();
    expect(screen.queryByText(/Запуск:/)).toBeNull();
    expect(screen.getByText('ничего')).toBeTruthy();
  });

  it('says so, and that merge is still re-checked, when the card cannot be made', async () => {
    respond = () => json({ message: 'GitHub 404' }, 502);
    renderCard();

    expect(await screen.findByText(/Карточку PR собрать не удалось/)).toBeTruthy();
    expect(screen.getByText(/Merge при этом проверяется заново/)).toBeTruthy();
  });
});
