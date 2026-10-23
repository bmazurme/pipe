import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('ReportsReleaseSection release info for the deployment owner', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const info = { shortSha: 'abc1234', shortId: 'r42', version: '1.2.3' };

  const renderSection = async () => {
    await store.dispatch(
      usersApiEndpoints.util.upsertQueryData('getMe', undefined, {
        id: 1,
        username: 'owner@x.com',
        status: 'online',
        isOwner: true,
      }),
    );

    return render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <ReportsReleaseSection />
        </ThemeProvider>
      </Provider>,
    );
  };

  it('shows the loading caption while the info request is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    await renderSection();

    expect(await screen.findByText(/первая сборка после изменений может занять до минуты/)).toBeTruthy();
    expect(screen.queryByText('Не удалось получить информацию о репозитории')).toBeNull();
  });

  it("shows the server's message when the info request fails", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ message: 'GitHub не настроен: задайте GITHUB_REPO и LOOP_GITHUB_TOKEN на bridge' }, 503),
      ),
    );

    await renderSection();

    expect(await screen.findByText(/GitHub не настроен: задайте GITHUB_REPO и LOOP_GITHUB_TOKEN на bridge/)).toBeTruthy();
    expect(screen.queryByText(/первая сборка после изменений/)).toBeNull();
  });

  it('asks again on «Повторить» and shows the version once it answers', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (request: Request) => {
      if (!request.url.includes('reports-release/info')) return json(null);
      calls += 1;

      return calls === 1 ? json({ message: 'boom' }, 500) : json(info);
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText(/Версия 1\.2\.3 · сборка r42 · из коммита main abc1234/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Не удалось получить информацию о репозитории')).toBeNull());
    expect(calls).toBe(2);
  });
});
