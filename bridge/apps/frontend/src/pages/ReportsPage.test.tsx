import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ReportsPage } from './ReportsPage';
import { store } from '../store';
import { reportsReleaseApi, reportsSettingsApi } from '../store/api';

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ReportsPage />
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
  store.dispatch(reportsReleaseApi.util.resetApiState());
  store.dispatch(reportsSettingsApi.util.resetApiState());
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('ReportsPage', () => {
  it('shows the latest commit and triggers a download on click', async () => {
    const user = userEvent.setup();
    let downloadRequested = false;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/reports-release/info')) return jsonResponse({ sha: 'abc1234567', shortSha: 'abc1234' });
        if (url.endsWith('/reports-release/download')) {
          downloadRequested = true;
          return new Response(new Blob(['zip bytes']), { status: 200 });
        }
        if (url.endsWith('/reports-settings')) return jsonResponse(null);
        return jsonResponse(null);
      }),
    );

    renderPage();

    await screen.findByText('Последний коммит main: abc1234');
    await user.click(screen.getByText('Скачать zip'));

    await waitFor(() => expect(downloadRequested).toBe(true));
  });

  it('shows "not saved yet" when there is no settings backup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/reports-release/info')) return jsonResponse({ sha: 'abc', shortSha: 'abc' });
        if (url.endsWith('/reports-settings')) return jsonResponse(null);
        return jsonResponse(null);
      }),
    );

    renderPage();

    await screen.findByText(/Бэкап ещё не сохранён/);
    expect(screen.getByLabelText('Удалить бэкап настроек')).toBeDisabled();
  });

  it('shows the saved date and deletes the backup after confirmation', async () => {
    const user = userEvent.setup();
    let deleted = false;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/reports-release/info')) return jsonResponse({ sha: 'abc', shortSha: 'abc' });
        if (url.endsWith('/reports-settings') && request.method === 'DELETE') {
          deleted = true;
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/reports-settings')) return jsonResponse({ updatedAt: '2026-10-06T00:00:00.000Z' });
        return jsonResponse(null);
      }),
    );

    renderPage();

    await screen.findByText(/Сохранён/);
    await user.click(screen.getByLabelText('Удалить бэкап настроек'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Удалить'));

    await waitFor(() => expect(deleted).toBe(true));
  });
});
