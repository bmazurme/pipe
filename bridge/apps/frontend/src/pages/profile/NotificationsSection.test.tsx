import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { NotificationsSection } from './NotificationsSection';
import { store } from '../../store';
import { usersApi } from '../../store/api';

const SETTINGS = {
  quietHours: '23:00-08:00',
  timezone: 'Europe/Moscow',
  isCustom: false,
  appliesToChat: true,
  isQuietNow: false,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function renderSection() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <NotificationsSection />
      </ThemeProvider>
    </Provider>,
  );
}

let saved: { quietHours: string; timezone: string } | undefined;

beforeEach(() => {
  saved = undefined;
  store.dispatch(usersApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (request.method === 'PUT') {
        saved = (await request.json()) as { quietHours: string; timezone: string };
        return jsonResponse({ ...SETTINGS, ...saved, isCustom: true });
      }

      return jsonResponse(SETTINGS);
    }),
  );
});

describe('NotificationsSection', () => {
  it('shows the current window and keeps Save disabled until something changes', async () => {
    renderSection();

    expect(await screen.findByLabelText('Начало тихих часов')).toHaveValue('23:00');
    expect(screen.getByLabelText('Конец тихих часов')).toHaveValue('08:00');
    expect(screen.getByText('Сейчас обычный режим')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('saves an edited window', async () => {
    const user = userEvent.setup();
    renderSection();

    const from = await screen.findByLabelText('Начало тихих часов');
    await user.clear(from);
    await user.type(from, '22:30');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(saved).toEqual({ quietHours: '22:30-08:00', timezone: 'Europe/Moscow' }));
  });

  it('saves "off" when the switch is turned off', async () => {
    const user = userEvent.setup();
    renderSection();

    await screen.findByLabelText('Начало тихих часов');
    await user.click(screen.getByText('Тихие часы'));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(saved).toEqual({ quietHours: 'off', timezone: 'Europe/Moscow' }));
  });

  it('refuses an empty range and explains why', async () => {
    const user = userEvent.setup();
    renderSection();

    const to = await screen.findByLabelText('Конец тихих часов');
    await user.clear(to);
    await user.type(to, '23:00');

    expect(await screen.findByText('Начало и конец не могут совпадать')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });
});
