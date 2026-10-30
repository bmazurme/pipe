import { render, screen, waitFor, within } from '@testing-library/react';
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
  health: null,
  warnings: [],
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
  it("shows the board's disk and SSH warnings, and nothing for a board that reported none", async () => {
    boards = [
      board({
        host: 'ubuntu-green',
        health: { diskUsedPct: 91, diskFreeMb: 1200, sshAuthorizedKeys: 1, sshPasswordAuth: true },
        warnings: ['Диск заполнен на 91 %, свободно 1200 МБ', 'SSH принимает пароли (лучше только ключи)'],
      }),
      board({ host: 'ubuntu-white' }),
    ];
    renderPage();

    expect(await screen.findByText(/Диск заполнен на 91 %/)).toBeTruthy();
    expect(screen.getByText(/SSH принимает пароли/)).toBeTruthy();
    expect(screen.getByText(/SSH-ключей: 1/)).toBeTruthy();
    expect(screen.getAllByText('Состояние платы')).toHaveLength(1);
  });

  it('shows each board with what is outdated, and hides the current scripts until asked', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('ubuntu-red')).toBeTruthy();
    expect(screen.getByText('устарело: 1')).toBeTruthy();
    expect(screen.getByText('infra/scriptcheck/check-scripts.sh')).toBeTruthy();
    expect(screen.queryByText('infra/notify/notify-telegram')).toBeNull();
    expect(screen.getByText(/main c823ea5/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Показать все скрипты на ubuntu-red/ }));
    expect(screen.getByText('infra/notify/notify-telegram')).toBeTruthy();
  });

  it('lets the owner allow the update with the button', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Обновить скрипты на ubuntu-red' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'boards/ubuntu-red/updates' }));
  });

  it('shows the refusal of the server', async () => {
    const user = userEvent.setup();
    failUpdate = 'Кнопка устарела: main изменился';
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Обновить скрипты на ubuntu-red' }));

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

    const cancel = await screen.findByRole('button', { name: 'Отменить обновление на ubuntu-red' });
    boards = [board()];
    await user.click(cancel);

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'boards/ubuntu-red/updates/cancel' }));
    expect(await screen.findByRole('button', { name: 'Обновить скрипты на ubuntu-red' })).toBeTruthy();
  });

  it('lets the agent update itself, and says how that is made safe', async () => {
    boards = [board({ outdated: 1, updatable: 1, scripts: [script('infra/boardagent/board-agent.sh', 'outdated')] })];
    renderPage();

    expect(await screen.findByText(/Агент обновит и себя/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Обновить скрипты на ubuntu-red' })).toBeEnabled();
  });

  it('says what needs a manual copy when that is all that is outdated; disables the button for a board that is offline', async () => {
    boards = [
      board({ host: 'a', outdated: 1, updatable: 0, scripts: [script('infra/boardagent/rollback.sh', 'outdated')] }),
      board({ host: 'b', online: false }),
    ];
    renderPage();

    expect(await screen.findByText(/Устарело только то, что ставится вручную/)).toBeTruthy();
    expect(screen.getByText('не отвечает')).toBeTruthy();
    for (const button of screen.getAllByRole('button', { name: /^Обновить скрипты/ })) expect(button).toBeDisabled();
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

  it('names the board in the buttons, one button per board, and exposes the toggle state', async () => {
    const user = userEvent.setup();
    boards = [board(), board({ host: 'ubuntu-blue' })];
    renderPage();

    expect(await screen.findByRole('button', { name: 'Обновить скрипты на ubuntu-red' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Обновить скрипты на ubuntu-blue' })).toHaveLength(1);

    const toggle = screen.getByRole('button', { name: /Показать все скрипты на ubuntu-red/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Скрыть актуальные скрипты на ubuntu-red' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('names the board in the cancel button', async () => {
    const pending = { id: 5, sha: 'c823ea56' + 'a'.repeat(32), via: 'ui', createdAt: new Date().toISOString() };
    boards = [board({ pending }), board({ host: 'ubuntu-blue', pending })];
    renderPage();

    expect(await screen.findByRole('button', { name: 'Отменить обновление на ubuntu-red' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Отменить обновление на ubuntu-blue' })).toHaveLength(1);
  });

  it('shows a failed request only in the card of its board, and the alert can be closed', async () => {
    const user = userEvent.setup();
    failUpdate = 'Кнопка устарела: main изменился';
    boards = [board(), board({ host: 'ubuntu-blue' })];
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Обновить скрипты на ubuntu-blue' }));

    const message = await screen.findByText('Кнопка устарела: main изменился');
    expect(screen.getAllByText('Кнопка устарела: main изменился')).toHaveLength(1);
    const card = screen.getByText('ubuntu-blue').closest('.g-card') as HTMLElement;
    expect(within(card).getByText('Кнопка устарела: main изменился')).toBe(message);
    expect(within(screen.getByText('ubuntu-red').closest('.g-card') as HTMLElement).queryByText('Кнопка устарела: main изменился')).toBeNull();

    await user.click(within(card).getByRole('button', { name: /close|закрыть/i }));
    await waitFor(() => expect(screen.queryByText('Кнопка устарела: main изменился')).toBeNull());
  });
});
