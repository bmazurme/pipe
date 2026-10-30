import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { dashboardApi } from '../../store/api';
import { ReleasesCard } from './ReleasesCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ReleasesCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(dashboardApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('ReleasesCard', () => {
  it('lists each release with its result, short commit, the PRs in it and the reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([
          { sha: '9781a0d'.padEnd(40, 'a'), previousSha: 'c823ea5', result: 'rolled_back', detail: 'здоровье не прошло', prNumbers: [41, 42], at: new Date().toISOString() },
          { sha: '5ccd3be'.padEnd(40, 'b'), previousSha: '9781a0d', result: 'deployed', detail: null, prNumbers: [], at: new Date(Date.now() - 3600_000).toISOString() },
        ]),
      ),
    );
    renderCard();

    expect(await screen.findByText('откатился')).toBeTruthy();
    expect(screen.getByText('9781a0d')).toBeTruthy();
    expect(screen.getByText(/#41, #42/)).toBeTruthy();
    expect(screen.getByText(/здоровье не прошло/)).toBeTruthy();
    expect(screen.getByText('выкачен')).toBeTruthy();
    expect(screen.getByText(/PR неизвестны/)).toBeTruthy();
  });

  it('explains how reports start to arrive when there are none yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderCard();

    expect(await screen.findByText(/Отчётов о релизах пока нет/)).toBeTruthy();
  });

  it('shows the error when the list cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});
