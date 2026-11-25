import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { IssuesTab } from './IssuesTab';
import { store } from '../../store';
import { improveApi } from '../../store/api';

const makeIssue = (number: number) => ({
  number,
  title: `Задача ${number}`,
  body: '',
  htmlUrl: `https://github.com/acme/repo/issues/${number}`,
  createdAt: new Date().toISOString(),
  labels: ['loop'],
  run: null,
});

let releaseBatch: () => void;
let batchBody: unknown;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <IssuesTab configured />
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  releaseBatch = () => undefined;
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (path === 'improve/issues') return json([makeIssue(1), makeIssue(2), makeIssue(3)]);
      if (path === 'improve/runs/batch') {
        batchBody = await request.clone().json().catch(() => undefined);
        await new Promise<void>((resolve) => {
          releaseBatch = resolve;
        });

        return json({ started: [1, 2], skipped: [] });
      }

      return json({});
    }),
  );
});

describe("IssuesTab with the router's 'Авто'", () => {
  it('offers it first among the models, starts the selected issues on it, and remembers the choice', async () => {
    const user = userEvent.setup();

    try {
      localStorage.clear();
    } catch {
      // not available: the choice just is not remembered
    }
    renderTab();

    await user.click(await screen.findByText('Claude Sonnet'));
    await user.click(await screen.findByText('Авто (маршрутизатор выбирает)'));
    await user.click(await screen.findByRole('checkbox', { name: 'Выбрать #1' }));
    await user.click(screen.getByRole('button', { name: /Запустить выбранные/ }));

    await waitFor(() => expect(batchBody).toMatchObject({ issueNumbers: [1], model: 'auto' }));
    releaseBatch();
    expect(localStorage.getItem('improve.model')).toBe('auto');
  });
});

describe('IssuesTab', () => {
  it('links each issue to GitHub in a new tab', async () => {
    renderTab();

    const link = await screen.findByRole('link', { name: /Issue #2 на GitHub/ });

    expect(link).toHaveAttribute('href', 'https://github.com/acme/repo/issues/2');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('locks only the rows of a pending batch and shows the hint meanwhile', async () => {
    const user = userEvent.setup();
    renderTab();

    expect(screen.queryByText(/Готовим снимок репозитория/)).not.toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: 'Выбрать #1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать #2' }));
    await user.click(screen.getByRole('button', { name: /Запустить выбранные/ }));

    expect(await screen.findByText(/Готовим снимок репозитория/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Выбрать #1' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Выбрать #2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Запустить #1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Запустить #2' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Выбрать #3' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Запустить #3' })).toBeEnabled();

    releaseBatch();

    await waitFor(() => expect(screen.queryByText(/Готовим снимок репозитория/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Запустить #1' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Выбрать #2' })).toBeEnabled();
  });

  it('warns when the list is the last good one served because GitHub failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([makeIssue(1)]), {
            status: 200,
            headers: { 'content-type': 'application/json', 'X-Issues-Stale-Since': new Date().toISOString() },
          }),
      ),
    );
    renderTab();

    expect(await screen.findByText(/GitHub недоступен — список задач от \d{2}:\d{2}/)).toBeInTheDocument();
  });
});
