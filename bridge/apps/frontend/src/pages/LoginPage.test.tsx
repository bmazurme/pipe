import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppThemeProvider } from '../app/providers/ThemeProvider';
import { LoginPage } from './LoginPage';
import { store } from '../store';
import { authApi, getGithubLoginUrl, getYandexLoginUrl } from '../store/api';

const auth = { isLoading: false, isAuthenticated: false };

vi.mock('../app/providers/AuthProvider', () => ({
  useAuth: () => auth,
}));

let providersResponse: () => Response;

beforeEach(() => {
  auth.isLoading = false;
  auth.isAuthenticated = false;
  store.dispatch(authApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname.endsWith('/oauth/providers')) {
        return providersResponse();
      }

      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

function providers(list: string[]) {
  providersResponse = () =>
    new Response(JSON.stringify({ providers: list }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

function renderPage() {
  return render(
    <Provider store={store}>
      <AppThemeProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>home page</div>} />
          </Routes>
        </MemoryRouter>
      </AppThemeProvider>
    </Provider>,
  );
}

describe('LoginPage', () => {
  it('falls back to Yandex only when the providers request fails', async () => {
    providersResponse = () => new Response('boom', { status: 500 });
    renderPage();

    const yandex = await screen.findByRole('link', { name: /Войти через Яндекс/ });
    expect(yandex).toHaveAttribute('href', getYandexLoginUrl());
    // let the failed request settle, then make sure nothing else appeared or vanished
    await vi.waitFor(() => expect(store.getState().authApi.queries).not.toEqual({}));
    await vi.waitFor(() =>
      expect(Object.values(store.getState().authApi.queries)[0]?.status).toBe('rejected'),
    );
    expect(screen.getByRole('link', { name: /Войти через Яндекс/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /GitHub/ })).toBeNull();
  });

  it('shows only GitHub, as the primary button, when Yandex is not configured', async () => {
    providers(['github']);
    renderPage();

    const github = await screen.findByRole('link', { name: /Войти через GitHub/ });
    expect(github).toHaveAttribute('href', getGithubLoginUrl());
    expect(github.className).toContain('g-button_view_action');
    expect(screen.queryByRole('link', { name: /Яндекс/ })).toBeNull();
  });

  it('shows both providers with GitHub secondary', async () => {
    providers(['yandex', 'github']);
    renderPage();

    const github = await screen.findByRole('link', { name: /Войти через GitHub/ });
    expect(github.className).toContain('g-button_view_outlined');
    expect(screen.getByRole('link', { name: /Войти через Яндекс/ })).toHaveAttribute(
      'href',
      getYandexLoginUrl(),
    );
  });

  it('shows a single disabled loading button while the session is checked', () => {
    auth.isLoading = true;
    providers(['yandex', 'github']);
    renderPage();

    const button = screen.getByRole('button', { name: 'Войти' });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('redirects an authenticated user to the home page', () => {
    auth.isAuthenticated = true;
    providers(['yandex']);
    renderPage();

    expect(screen.getByText('home page')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Яндекс/ })).toBeNull();
  });
});
