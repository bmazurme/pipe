import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { improveApi } from '../../store/api';
import { MergePrCard } from './MergePrCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const REVIEW = {
  number: 12,
  title: 'Add the thing',
  url: 'https://github.com/o/r/pull/12',
  risk: { level: 'low', text: 'Риск: низкий (документация)' },
  diff: { files: 1, additions: 3, deletions: 1, areas: [{ name: 'документация', files: 1 }], largest: [] },
  attention: [],
  checked: ['CI зелёный'],
  notChecked: ['Diff человеком не читался — это и есть ваше ревью'],
  run: null,
  improveUrl: null,
};

let calls: string[];
let reviewStatus: number;

beforeEach(() => {
  calls = [];
  reviewStatus = 200;
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      calls.push(`${request.method} ${path}`);

      if (path === 'improve/prs/12/review') return reviewStatus === 200 ? json(REVIEW) : json({ message: 'boom' }, reviewStatus);

      return json({ merged: true, reason: 'ok', prUrl: 'https://github.com/o/r/pull/12', baseRef: 'main' });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderCard = (onDone = vi.fn()) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MergePrCard action={{ type: 'merge-pr', pr: 12 } as never} onDone={onDone} />
      </ThemeProvider>
    </Provider>,
  );

describe('MergePrCard', () => {
  it('shows the review of the pull request before the button, and merges only on the click', async () => {
    const user = userEvent.setup();

    renderCard();

    expect(await screen.findByText('Риск: низкий (документация)')).toBeTruthy();
    expect(screen.getByText('✓ CI зелёный')).toBeTruthy();
    expect(calls).toEqual(['GET improve/prs/12/review']);

    await user.click(screen.getByRole('button', { name: 'Смержить' }));

    await waitFor(() => expect(calls).toContain('POST improve/pr-merge'));
    expect(await screen.findByText(/PR #12 влит в main/)).toBeTruthy();
  });

  it('still offers the merge when the review cannot be made — bridge re-checks it itself', async () => {
    reviewStatus = 502;
    renderCard();

    expect(await screen.findByText(/Карточку PR собрать не удалось/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Смержить' })).toBeTruthy();
  });
});
