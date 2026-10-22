import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardsPage } from './BoardsPage';
import { store } from '../store';
import { boardsApi } from '../store/api';

type Sent = { method: string; path: string };
let sent: Sent[];
let boards: unknown[];
let failUpdate: string | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const script = (repoPath: string, status: string) => ({ installed: `/usr/local/lib/${repoPath}`, repoPath, status, installedHash: 'a', mainHash: 'b' });
const board = (over: Record<string, unknown> = {}) => ({
  host: 'ubuntu-red',
  reportedAt: new Date().toISOString(),
  online: true,
  mainSha: 'c823ea56' + 'a'.repeat(32),
  agentVersion: '1',
  scripts: [script('infra/scriptcheck/check-scripts.sh', 'outdated'), script('infra/notify/notify-telegram', 'current')],
  outdated: 1,
  updatable: 1,
  pending: null,
  lastUpdate: null,
  ...over,
});

beforeEach(() => {
  sent = [];
  boards = [board()];
  failUpdate = null;
  store.dispatch(boardsApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') {
        sent.push({ method: request.method, path });

        return failUpdate ? json({ message: failUpdate }, 409) : json({ id: 5, sha: 'x', repoPaths: [], status: 'pending' });
      }
      if (path === 'boards') return json(boards);

      return json([]);
    }),
  );
});

const renderPage = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <BoardsPage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('BoardsPage', () => {
  it('shows each board with what is outdated, and hides the current scripts until asked', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('ubuntu-red')).toBeTruthy();
    expect(screen.getByText('устарело: 1')).toBeTruthy();
    expect(screen.getByText('infra/scriptcheck/check-scripts.sh')).toBeTruthy();
    expect(screen.queryByText('infra/notify/notify-telegram')).toBeNull();
    expect(screen.getByText(/main c823ea5/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Показать все \(2\)/ }));
    expect(screen.getByText('infra/notify/notify-telegram')).toBeTruthy();
  });

  it('lets the owner allow the update with the button', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Обновить \(1\)/ }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'boards/ubuntu-red/updates' }));
  });

  it('shows the refusal of the server', async () => {
    const user = userEvent.setup();
    failUpdate = 'Кнопка устарела: main изменился';
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Обновить \(1\)/ }));

    expect(await screen.findByText('Кнопка устарела: main изменился')).toBeTruthy();
  });

  it('shows a waiting decision instead of the button', async () => {
    boards = [board({ pending: { id: 5, sha: 'c823ea56' + 'a'.repeat(32), via: 'telegram', createdAt: new Date().toISOString() } })];
    renderPage();

    expect(await screen.findByText(/ждёт плату: c823ea5/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Обновить/ })).toBeNull();
  });

  it('lets the owner cancel a waiting decision, and the button comes back', async () => {
    const user = userEvent.setup();
    boards = [board({ pending: { id: 5, sha: 'c823ea56' + 'a'.repeat(32), via: 'ui', createdAt: new Date().toISOString() } })];
    renderPage();

    const cancel = await screen.findByRole('button', { name: 'Отменить' });
    boards = [board()];
    await user.click(cancel);

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'boards/ubuntu-red/updates/cancel' }));
    expect(await screen.findByRole('button', { name: /Обновить \(1\)/ })).toBeTruthy();
  });

  it('says that only the agent itself is outdated and needs a manual copy; disables the button for a board that is offline', async () => {
    boards = [
      board({ host: 'a', outdated: 1, updatable: 0, scripts: [script('infra/boardagent/board-agent.sh', 'outdated')] }),
      board({ host: 'b', online: false }),
    ];
    renderPage();

    expect(await screen.findByText(/Устарел только сам агент обновлений/)).toBeTruthy();
    expect(screen.getByText('не отвечает')).toBeTruthy();
    for (const button of screen.getAllByRole('button', { name: /^Обновить/ })) expect(button).toBeDisabled();
  });

  it('shows the result of the last update', async () => {
    boards = [board({ outdated: 0, updatable: 0, lastUpdate: { id: 4, status: 'failed', sha: 'c823ea56' + 'a'.repeat(32), result: 'bash -n failed', finishedAt: new Date().toISOString(), createdAt: new Date().toISOString() } })];
    renderPage();

    expect(await screen.findByText(/ошибка, c823ea5/)).toBeTruthy();
    expect(screen.getByText(/bash -n failed/)).toBeTruthy();
  });

  it('explains the empty state', async () => {
    boards = [];
    renderPage();

    expect(await screen.findByText('Плат пока нет')).toBeTruthy();
  });
});
