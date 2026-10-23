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

describe('ReportsReleaseSection for the owner', () => {
  const infoBody = { sha: 's', shortSha: 's', releaseId: 'newnewnewnew1', shortId: 'newnewnewnew', version: null, sha256: 'x', size: 1 };

  async function renderAs(installed: unknown, offered = infoBody) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) =>
        Response.json(req.url.endsWith('/installed') ? installed : offered),
      ),
    );
    await store.dispatch(
      usersApiEndpoints.util.upsertQueryData('getMe', undefined, {
        id: 1,
        username: 'o@x.com',
        status: 'online',
        isOwner: true,
      }),
    );
    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <ReportsReleaseSection />
        </ThemeProvider>
      </Provider>,
    );
  }

  it('says the installed build is current when the ids match', async () => {
    await renderAs({ releaseId: 'newnewnewnew1', shortId: 'newnewnewnew', checkedAt: new Date().toISOString() });

    expect(await screen.findByText(/сборка newnewnewnew — актуальна/)).toBeTruthy();
    expect(screen.getByText(/проверял обновления 0 мин назад/)).toBeTruthy();
  });

  it('names the new build when they differ', async () => {
    await renderAs({ releaseId: 'old', shortId: 'old', checkedAt: new Date().toISOString() });

    expect(await screen.findByText(/сборка old — доступна новая сборка newnewnewnew/)).toBeTruthy();
  });

  it('says reports has not been in touch when there is no check-in', async () => {
    await renderAs(null);

    expect(await screen.findByText('reports ещё не обращался к bridge')).toBeTruthy();
  });
});
