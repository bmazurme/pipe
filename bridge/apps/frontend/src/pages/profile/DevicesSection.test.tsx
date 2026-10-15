import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { DevicesSection } from './DevicesSection';
import { sessionsApi } from '../../store/api';
import authReducer from '../../store/slices/auth-slice';
import sessionsReducer from '../../store/slices/sessions-slice';

const CURRENT = {
  id: 1,
  userAgent: null,
  ip: '10.0.0.1',
  createdAt: '2026-09-30T07:00:00.000Z',
  lastUsedAt: null,
  isCurrent: true,
};
const OTHER_A = { ...CURRENT, id: 2, ip: '10.0.0.2', isCurrent: false };
const OTHER_B = { ...CURRENT, id: 3, ip: '10.0.0.3', isCurrent: false };

// A fresh store per test: the real one keeps the sessions slice between tests.
function renderSection() {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      sessions: sessionsReducer,
      [sessionsApi.reducerPath]: sessionsApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(sessionsApi.middleware),
  });

  return render(
    // The section is typed against the app's RootState, which this slim store does not match.
    <Provider store={store as never}>
      <ThemeProvider theme="light">
        <DevicesSection />
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface ServerOptions {
  failRevokeIds?: number[];
  // Resolved by the test to let a pending revoke finish.
  revokeGate?: Promise<void>;
}

// A tiny stateful backend: revokes drop the session, so the refetch the
// mutation triggers sees the same list the slice already shows.
function stubSessionsServer(initial: unknown[], options: ServerOptions = {}) {
  let sessions = [...initial] as { id: number }[];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (request.method === 'DELETE') {
        const id = Number(new URL(request.url).pathname.split('/').pop());
        await options.revokeGate;
        if (options.failRevokeIds?.includes(id)) {
          return jsonResponse({ message: 'boom' }, 500);
        }
        sessions = sessions.filter((session) => session.id !== id);
        return new Response(null, { status: 204 });
      }
      return jsonResponse(sessions);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The tooltip's title replaces the aria-label once it is shown, hence no colon in the pattern.
const revokeButtons = () => screen.queryAllByRole('button', { name: /^Завершить сеанс/ });

describe('DevicesSection', () => {
  it('marks the current session and offers no revoke button for it', async () => {
    stubSessionsServer([CURRENT]);

    renderSection();

    await screen.findByText('Это устройство');
    expect(revokeButtons()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Завершить остальные' })).toBeNull();
  });

  it('removes a revoked row and disables the other rows while the request is in flight', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const revokeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubSessionsServer([CURRENT, OTHER_A, OTHER_B], { revokeGate });

    renderSection();
    await screen.findByText('Это устройство');
    expect(revokeButtons()).toHaveLength(2);

    await user.click(revokeButtons()[0]);

    await waitFor(() => expect((revokeButtons()[1] as HTMLButtonElement).disabled).toBe(true));

    release();

    await waitFor(() => expect(revokeButtons()).toHaveLength(1));
    expect(screen.queryByText(/10\.0\.0\.2/)).toBeNull();
    expect(screen.getByText(/10\.0\.0\.3/)).toBeTruthy();
    expect((revokeButtons()[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an error and keeps the row when a single revoke fails', async () => {
    const user = userEvent.setup();
    stubSessionsServer([CURRENT, OTHER_A], { failRevokeIds: [OTHER_A.id] });

    renderSection();
    await screen.findByText('Это устройство');

    await user.click(revokeButtons()[0]);

    await screen.findByText('Не удалось завершить сеанс');
    expect(revokeButtons()).toHaveLength(1);
    expect(screen.getByText(/10\.0\.0\.2/)).toBeTruthy();
  });

  it('keeps the successful revokes and reports a partial failure on revoke-all', async () => {
    const user = userEvent.setup();
    stubSessionsServer([CURRENT, OTHER_A, OTHER_B], { failRevokeIds: [OTHER_B.id] });

    renderSection();
    await screen.findByText('Это устройство');

    await user.click(screen.getByRole('button', { name: 'Завершить остальные' }));
    await user.click(await screen.findByRole('button', { name: 'Завершить' }));

    await screen.findByText('Не удалось завершить часть сеансов');
    await waitFor(() => expect(screen.queryByText(/10\.0\.0\.2/)).toBeNull());
    expect(screen.getByText(/10\.0\.0\.3/)).toBeTruthy();
    expect(revokeButtons()).toHaveLength(1);
  });

  it('shows a load error instead of the empty state when the list fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'boom' }, 500)),
    );

    renderSection();

    await screen.findByText('Не удалось загрузить список устройств');
    expect(screen.queryByText('Активных сеансов нет')).toBeNull();
  });
});
