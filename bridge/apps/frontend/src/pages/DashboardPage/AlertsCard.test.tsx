import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi } from '../../store/api';
import { AlertsCard } from './AlertsCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const budget = (over: object = {}, verdict = 'over') => ({
  target: 5,
  noisy: 15,
  today: { day: '2026-10-08', sent: 7, urgent: 1, deduped: 12, grouped: 4, quiet: 2, verdict, top: [{ kind: '🔴 Задача #N: не удалось открыть PR', attempts: 9 }], ...over },
  days: [
    { day: '2026-10-08', sent: 7, urgent: 1, deduped: 12, grouped: 4, quiet: 2 },
    { day: '2026-10-07', sent: 3, urgent: 0, deduped: 0, grouped: 0, quiet: 0 },
  ],
});

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <AlertsCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('AlertsCard', () => {
  it('shows today against the target, with the verdict, what was not sent, and the days', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(budget())));
    renderCard();

    expect(await screen.findByText('7 из 5')).toBeTruthy();
    expect(screen.getByText('выше цели')).toBeTruthy();
    expect(screen.getByText(/срочных: 1/)).toBeTruthy();
    expect(screen.getByText(/повторов 12, сгруппировано 4, отложено на утро 2/)).toBeTruthy();
    expect(screen.getByText(/08\.10 — 7 · 07\.10 — 3/)).toBeTruthy();
  });

  it('names who is noisiest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(budget())));
    renderCard();

    expect(await screen.findByText('🔴 Задача #N: не удалось открыть PR')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
  });

  it.each([
    ['ok', 'в бюджете'],
    ['over', 'выше цели'],
    ['noisy', 'шумно'],
  ])('says %s as «%s»', async (verdict, label) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(budget({}, verdict))));
    renderCard();

    expect(await screen.findByText(label)).toBeTruthy();
  });

  it('says it could not load instead of a calm zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});
