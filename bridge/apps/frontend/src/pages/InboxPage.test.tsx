import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store } from '../store';
import { inboxApi } from '../store/api';
import { InboxPage } from './InboxPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const renderPage = () => {
  store.dispatch(inboxApi.util.resetApiState());

  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <InboxPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
};

describe('InboxPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists what waits, in the server order, each with a way to the page that owns it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([
          { id: 'pr:5', kind: 'pr_ready', severity: 'high', title: 'PR #5 ждёт вашего решения', detail: 'Fix it — CI зелёный', link: '/improve', externalUrl: 'https://github.com/o/r/pull/5' },
          { id: 'questions', kind: 'questions', severity: 'medium', title: 'Открытых вопросов: 2', link: '/questions', since: new Date().toISOString() },
        ]),
      ),
    );
    renderPage();

    const titles = await screen.findAllByText(/PR #5|Открытых вопросов/);

    expect(titles.map((node) => node.textContent)).toEqual(['PR #5 ждёт вашего решения', 'Открытых вопросов: 2']);
    expect(screen.getByText('срочно')).toBeTruthy();
    expect(screen.getByText('важно')).toBeTruthy();
    expect(screen.getByRole('link', { name: /PR на GitHub/ }).getAttribute('href')).toBe('https://github.com/o/r/pull/5');
    expect(screen.getAllByRole('link', { name: 'Открыть' }).map((link) => link.getAttribute('href'))).toEqual(['/improve', '/questions']);
  });

  it('says so when nothing waits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderPage();

    expect(await screen.findByText('Ничего не ждёт решения')).toBeTruthy();
  });

  it('does not claim nothing waits when the only item says a source could not be checked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([{ id: 'sources-unavailable', kind: 'source_unavailable', severity: 'low', title: 'Не удалось проверить: GitHub', link: '/logs' }]),
      ),
    );
    renderPage();

    expect(await screen.findByText('Не удалось проверить: GitHub')).toBeTruthy();
    expect(screen.queryByText('Ничего не ждёт решения')).toBeNull();
  });

  it('shows the error when the list cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderPage();

    expect(await screen.findByText(/boom|Не удалось загрузить список/)).toBeTruthy();
  });
});
