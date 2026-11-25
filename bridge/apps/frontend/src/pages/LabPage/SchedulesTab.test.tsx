import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { SchedulesTab } from './SchedulesTab';
import { store } from '../../store';
import { labApi } from '../../store/api';

const makeSchedule = (id: number, name: string) => ({
  id,
  projectId: 7,
  name,
  enabled: true,
  hour: 2,
  minute: 0,
  timezone: 'Europe/Moscow',
  weekdays: null,
  onlyOnNewCommits: false,
  model: 'sonnet',
  executor: 'any',
  task: 'Обновить зависимости',
  contextId: null as number | null,
  lastRunAt: null,
  lastResult: null,
});

let sent: { method: string; path: string; body: unknown }[];
let saveFails: boolean;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <SchedulesTab />
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  sent = [];
  saveFails = false;
  store.dispatch(labApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') {
        const text = await request.clone().text();

        sent.push({ method: request.method, path, body: text ? JSON.parse(text) : undefined });
        if (saveFails) return json({ message: 'nope' }, 500);

        return json({});
      }
      if (path === 'lab/schedules') return json([makeSchedule(1, 'Первое'), makeSchedule(2, 'Второе')]);
      if (path === 'lab/projects') return json([{ id: 7, name: 'Лодка', repo: 'me/boat', baseBranch: 'main', tokenHint: 'ABCD', checkedAt: null, tokenExpiresAt: null, canWrite: true }]);

      return json([]);
    }),
  );
});

describe('lab SchedulesTab row enable switch', () => {
  it('sends enabled: false with the other fields unchanged', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('switch', { name: 'Включено: Первое' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({
      projectId: 7,
      name: 'Первое',
      enabled: false,
      hour: 2,
      minute: 0,
      timezone: 'Europe/Moscow',
      weekdays: null,
      onlyOnNewCommits: false,
      model: 'sonnet',
      executor: 'any',
      task: 'Обновить зависимости',
      contextId: null,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an error when the toggle fails', async () => {
    saveFails = true;
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('switch', { name: 'Включено: Первое' }));

    expect(await screen.findByText(/Не удалось изменить расписание|nope/)).toBeInTheDocument();
  });
});
