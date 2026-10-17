import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ReportsReleaseSection } from './ReportsReleaseSection';
import { store } from '../../store';
import { reportsReleaseApi, usersApiEndpoints } from '../../store/api';

beforeEach(() => {
  store.dispatch(reportsReleaseApi.util.resetApiState());
});

describe('ReportsReleaseSection for an account that is not the deployment owner', () => {
  it('shows the owner-only notice, no download button and asks the server nothing', async () => {
    const fetchMock = vi.fn(async () => new Response('null', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await store.dispatch(
      usersApiEndpoints.util.upsertQueryData('getMe', undefined, {
        id: 2,
        username: 'guest@x.com',
        status: 'online',
        isOwner: false,
      }),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <ReportsReleaseSection />
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByText('Доступно только владельцу развёртывания')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Скачать zip/ })).toBeNull();
    expect(screen.queryByText('Не удалось получить информацию о репозитории')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
