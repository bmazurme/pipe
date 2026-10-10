import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { store } from './store';

const auth = vi.hoisted(() => ({ isAuthenticated: true }));

// AuthProvider would fire real checkAuth/getMe requests; the routing under
// test only needs useAuth's answer.
vi.mock('./app/providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: auth.isAuthenticated,
    user: { username: 'tester' },
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

function renderAt(path: string) {
  window.history.pushState({}, '', path);

  return render(
    <Provider store={store}>
      <App />
    </Provider>,
  );
}

describe('App catch-all route', () => {
  afterEach(() => {
    auth.isAuthenticated = true;
    window.history.pushState({}, '', '/');
  });

  it('renders the 404 content with a link home for an unknown path', async () => {
    renderAt('/no-such-page');

    expect(
      await screen.findByRole('heading', { name: 'Страница не найдена' }),
    ).toBeInTheDocument();
    expect(screen.getByText('/no-such-page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('still redirects a signed-out visitor to the login page', async () => {
    auth.isAuthenticated = false;
    renderAt('/no-such-page');

    await vi.waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(
      screen.queryByRole('heading', { name: 'Страница не найдена' }),
    ).not.toBeInTheDocument();
  });
});
