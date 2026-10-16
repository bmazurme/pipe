import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReportsSettingsBackupSection } from './ReportsSettingsBackupSection';
import { store } from '../../store';
import { reportsSettingsApi } from '../../store/api';

let backup: unknown;
let failDelete: boolean;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  backup = { updatedAt: '2026-10-01T00:00:00Z' };
  failDelete = false;
  store.dispatch(reportsSettingsApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (request.method === 'GET') return json(backup);
      if (failDelete) return json({ message: 'boom' }, 500);
      backup = null;

      return new Response(null, { status: 204 });
    }),
  );
});

const renderSection = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ReportsSettingsBackupSection />
      </ThemeProvider>
    </Provider>,
  );

const openDialog = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Удалить бэкап настроек' }));

  return screen.findByRole('dialog');
};

describe('ReportsSettingsBackupSection', () => {
  it('closes the dialog and shows the empty state after a successful delete', async () => {
    renderSection();
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/Бэкап ещё не сохранён/)).toBeTruthy();
  });

  it('keeps the dialog open with the error when the delete fails', async () => {
    failDelete = true;
    renderSection();
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    expect(await within(dialog).findByText('Не удалось удалить бэкап настроек')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Удалить' }) as HTMLButtonElement).disabled).toBe(false));
  });
});
