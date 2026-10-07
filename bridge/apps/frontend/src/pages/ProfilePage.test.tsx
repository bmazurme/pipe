import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ProfilePage } from './ProfilePage';
import { store } from '../store';
import { apiKeysApi, sessionsApi, usersApi } from '../store/api';

vi.mock('../app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'owner@yandex.ru', status: 'hello' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refreshUser: async () => {},
  }),
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function renderPage(path = '/profile') {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={[path]}>
          <ProfilePage />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

beforeEach(() => {
  store.dispatch(usersApi.util.resetApiState());
  store.dispatch(apiKeysApi.util.resetApiState());
  store.dispatch(sessionsApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (request.url.includes('notification-settings')) {
        return jsonResponse({ quietHours: '23:00-08:00', timezone: 'Europe/Moscow', isCustom: false, appliesToChat: true, isQuietNow: false });
      }

      if (request.url.includes('logs/summary')) {
        return jsonResponse({
          days: 7,
          total: 0,
          byLevel: {},
          bySource: {},
          jobs: { succeeded: 0, failed: 0, successRate: null, avgDurationMs: null },
          topErrors: [],
          slowestRoutes: [],
        });
      }

      return jsonResponse([]);
    }),
  );
});

describe('ProfilePage', () => {
  it('opens on the account tab with identity, status and notification settings', async () => {
    renderPage();

    expect(screen.getByText('owner@yandex.ru')).toBeTruthy();
    expect(screen.getByDisplayValue('hello')).toBeTruthy();
    expect(await screen.findByText('Уведомления в Telegram')).toBeTruthy();
    expect(screen.queryByText('API-ключи')).toBeNull();
  });

  it('offers to save or undo the status only once it has been edited', async () => {
    const user = userEvent.setup();
    renderPage();

    // "Отменить" exists only on the status form (the notifications card has its own Save).
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull();

    await user.type(screen.getByDisplayValue('hello'), '!');

    expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Отменить' }));

    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull();
    expect(screen.getByDisplayValue('hello')).toBeTruthy();
  });

  it('keeps API keys and devices on the access tab, with the X-Api-Key usage hint', async () => {
    renderPage('/profile?tab=access');

    expect(await screen.findByText('API-ключи')).toBeTruthy();
    expect(screen.getByText('Устройства')).toBeTruthy();
    expect(screen.getAllByText(/X-Api-Key/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Уведомления в Telegram')).toBeNull();
  });

  it('no longer advertises the shared-secret day-offs integration', async () => {
    renderPage('/profile?tab=access');

    await screen.findByText('API-ключи');

    expect(screen.queryByText('Интеграции')).toBeNull();
    expect(screen.queryByText(/TIME_EXPORT_API_KEY/)).toBeNull();
  });

  it('switches tabs and falls back to the account tab for an unknown one', async () => {
    const user = userEvent.setup();
    renderPage('/profile?tab=bogus');

    expect(screen.getByDisplayValue('hello')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Логи' }));

    expect(await screen.findByText('Логи для улучшения')).toBeTruthy();
  });
});
