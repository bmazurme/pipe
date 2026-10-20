import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import type { UpdateStatusType } from '@reports/shared';

import { store } from '../../store';
import { reportsApi } from '../../store/api';
import UpdateBanner from './index';

const status = (patch: Partial<UpdateStatusType>): UpdateStatusType => ({
  current: { releaseId: 'a'.repeat(64), shortId: 'aaaaaaaaaaaa', version: '1.0.0' },
  latest: { releaseId: 'b'.repeat(64), shortId: 'bbbbbbbbbbbb', version: '1.1.0' },
  updateAvailable: true,
  checkedAt: '2026-10-20T08:00:00.000Z',
  error: null,
  ...patch,
});

let calls: string[];
let answer: () => UpdateStatusType;

beforeEach(() => {
  store.dispatch(reportsApi.util.resetApiState());
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      calls.push(new URL(request.url).search);
      return Response.json({ type: 'message', data: answer() });
    }),
  );
});

const renderBanner = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <UpdateBanner />
      </ThemeProvider>
    </Provider>,
  );

describe('UpdateBanner', () => {
  it('says a new version is available, and which one against which', async () => {
    answer = () => status({});
    renderBanner();

    expect(await screen.findByText('Доступна новая версия reports')).toBeInTheDocument();
    expect(screen.getByText(/Новая: версия 1\.1\.0, сборка bbbbbbbbbbbb\. У вас: версия 1\.0\.0, сборка aaaaaaaaaaaa\./)).toBeInTheDocument();
  });

  it('says the running version is unknown when the install carries none', async () => {
    answer = () => status({ current: null });
    renderBanner();

    expect(await screen.findByText(/У вас: версия неизвестна\./)).toBeInTheDocument();
  });

  it('shows nothing when there is no update, or the check failed', async () => {
    answer = () => status({ updateAvailable: false });
    const { container, unmount } = renderBanner();
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(container).toBeEmptyDOMElement();
    unmount();

    store.dispatch(reportsApi.util.resetApiState());
    answer = () => status({ updateAvailable: false, latest: null, error: 'Bridge недоступен' });
    const failed = renderBanner();
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(failed.container).toBeEmptyDOMElement();
  });

  it('asks the server to check again on "Проверить снова"', async () => {
    answer = () => status({});
    const user = userEvent.setup();
    renderBanner();
    await screen.findByText('Доступна новая версия reports');

    await user.click(screen.getByRole('button', { name: 'Проверить снова' }));

    await vi.waitFor(() => expect(calls.some((search) => search.includes('refresh=1'))).toBe(true));
  });

  it('can be closed until the next release comes', async () => {
    answer = () => status({});
    const user = userEvent.setup();
    renderBanner();
    await screen.findByText('Доступна новая версия reports');

    await user.click(screen.getByRole('button', { name: /закрыть|close/i }));

    expect(screen.queryByText('Доступна новая версия reports')).not.toBeInTheDocument();
  });
});
