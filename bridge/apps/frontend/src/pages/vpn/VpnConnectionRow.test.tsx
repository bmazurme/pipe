import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { VpnConnectionRow } from './VpnConnectionRow';
import { store } from '../../store';
import { secretsApi, VpnConnection } from '../../store/api';

const CONNECTION = {
  id: 7,
  name: 'office',
  serverAddress: 'vpn.example.com',
  isActive: false,
} as unknown as VpnConnection;

function renderRow() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ul>
          <VpnConnectionRow connection={CONNECTION} />
        </ul>
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

beforeEach(() => {
  store.dispatch(secretsApi.util.resetApiState());
});

describe('VpnConnectionRow', () => {
  it('only deletes after a second, confirming click', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    renderRow();

    await user.click(screen.getByRole('button', { name: 'Удалить подключение: office' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Подтвердить удаление подключения: office' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0] as unknown as [Request];
    expect(request[0].method).toBe('DELETE');
  });

  it('shows an error when deleting fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'boom' }, 500)));

    renderRow();

    await user.click(screen.getByRole('button', { name: 'Удалить подключение: office' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить удаление подключения: office' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Не удалось удалить подключение');
  });

  it('shows an error when activating fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'boom' }, 500)));

    renderRow();

    await user.click(screen.getByRole('button', { name: 'Сделать активным' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Не удалось сделать подключение активным');
  });

  it('gives the share-link input an accessible name', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ link: 'vless://abc' })));

    renderRow();

    await user.click(screen.getByRole('button', { name: 'Ссылка' }));

    expect(await screen.findByLabelText('Ссылка подключения office')).toBeTruthy();
  });

  it('shows "Скопировано" for a moment and goes back, and clears its timer when the row goes away', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ link: 'vless://abc' })));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });

    const { unmount } = renderRow();

    await user.click(screen.getByRole('button', { name: 'Ссылка' }));
    await screen.findByLabelText('Ссылка подключения office');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // Other timers may exist (the store's cache timers, Gravity's): follow only the one that resets the label.
    const started = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');

    try {
      await act(async () => {
        screen.getByRole('button', { name: 'Скопировать' }).click();
      });
      expect(screen.getByRole('button', { name: 'Скопировано' })).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy();

      await act(async () => {
        screen.getByRole('button', { name: 'Скопировать' }).click();
      });

      const resetCall = started.mock.calls.map((call) => call[1]).lastIndexOf(2000);

      expect(resetCall).toBeGreaterThanOrEqual(0);

      const resetTimer = started.mock.results[resetCall].value;

      unmount();
      expect(cleared).toHaveBeenCalledWith(resetTimer);
    } finally {
      started.mockRestore();
      cleared.mockRestore();
      vi.useRealTimers();
    }
  });
});
