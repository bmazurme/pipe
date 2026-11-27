import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { boardsApi } from '../../store/api';
import { AutoUpdateCard } from './AutoUpdateCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const view = (over: object = {}) => ({ enabled: false, window: '03:00-05:00', timezone: 'Europe/Moscow', inWindowNow: false, last: null, ...over });

let sent: Array<{ method: string; body: unknown }>;
let current: object;
let saveFails: string | null;

beforeEach(() => {
  sent = [];
  current = view();
  saveFails = null;
  store.dispatch(boardsApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (request.method === 'PUT') {
        const body = await request.json();

        sent.push({ method: 'PUT', body });

        if (saveFails) return json({ message: saveFails }, 400);

        current = view(body);

        return json(current);
      }

      return json(current);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <AutoUpdateCard />
      </ThemeProvider>
    </Provider>,
  );

describe('AutoUpdateCard', () => {
  it('says it is off by default, with the window it would use', async () => {
    renderCard();

    expect(await screen.findByText('выключено')).toBeTruthy();
    expect((screen.getByLabelText('Окно') as HTMLInputElement).value).toBe('03:00-05:00');
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the switch and the window, and shows it on', async () => {
    const user = userEvent.setup();

    renderCard();
    await screen.findByText('выключено');
    await user.click(screen.getByLabelText('Обновлять worker самому'));
    await user.clear(screen.getByLabelText('Окно'));
    await user.type(screen.getByLabelText('Окно'), '02:00-04:00');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent).toEqual([{ method: 'PUT', body: { enabled: true, window: '02:00-04:00', timezone: 'Europe/Moscow' } }]));
    expect(await screen.findByText('включено')).toBeTruthy();
  });

  it('says whether it is the window now, so the owner sees why nothing happens', async () => {
    current = view({ enabled: true, inWindowNow: false });
    renderCard();

    expect(await screen.findByText('вне окна')).toBeTruthy();
  });

  it('shows what the server said when the window cannot be saved', async () => {
    const user = userEvent.setup();

    saveFails = 'Окно не разобрано';
    renderCard();
    await screen.findByText('выключено');
    await user.click(screen.getByLabelText('Обновлять worker самому'));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Окно не разобрано')).toBeTruthy();
  });

  it('shows the last automatic update and how it ended, with the reason when it failed', async () => {
    current = view({ enabled: true, last: { host: 'ubuntu-red', status: 'failed', at: new Date().toISOString(), result: 'новый контейнер не стартовал' } });
    renderCard();

    expect(await screen.findByText(/Последнее автообновление: ubuntu-red — не удалось/)).toBeTruthy();
    expect(screen.getByText(/новый контейнер не стартовал/)).toBeTruthy();
  });
});
