import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import type { UpdateProgressType, UpdateStatusType } from '@reports/shared';

import { store } from '../../store';
import { reportsApi } from '../../store/api';
import UpdateBanner from './index';

const status = (patch: Partial<UpdateStatusType> = {}): UpdateStatusType => ({
  current: { releaseId: 'a'.repeat(64), shortId: 'aaaaaaaaaaaa', version: '1.0.0' },
  latest: { releaseId: 'b'.repeat(64), shortId: 'bbbbbbbbbbbb', version: '1.1.0' },
  updateAvailable: true,
  checkedAt: new Date().toISOString(),
  error: null,
  selfUpdate: { available: true, reason: null },
  ...patch,
});

let requests: { path: string; search: string; method: string; body: string }[];
let statusReply: () => UpdateStatusType;
let progressReply: () => UpdateProgressType | null;
let applyReply: () => { type: string; data: unknown };

beforeEach(() => {
  store.dispatch(reportsApi.util.resetApiState());
  requests = [];
  progressReply = () => null;
  applyReply = () => ({ type: 'message', data: { releaseId: 'b'.repeat(64) } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);

      requests.push({ path: url.pathname, search: url.search, method: request.method, body: await request.clone().text() });
      if (url.pathname.endsWith('/update/progress')) return Response.json({ type: 'message', data: progressReply() });
      if (url.pathname.endsWith('/update/apply')) return Response.json(applyReply());

      return Response.json({ type: 'message', data: statusReply() });
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

const called = (suffix: string) => requests.filter((request) => request.path.endsWith(suffix));

describe('UpdateBanner', () => {
  it('says a new version is available, which one against which, and that the settings stay', async () => {
    statusReply = () => status();
    renderBanner();

    expect(await screen.findByText('Доступна новая версия reports')).toBeInTheDocument();
    expect(screen.getByText(/Новая: версия 1\.1\.0, сборка bbbbbbbbbbbb\. У вас: версия 1\.0\.0, сборка aaaaaaaaaaaa\./)).toBeInTheDocument();
    expect(screen.getByText(/Ваши настройки и \.env при обновлении не меняются/)).toBeInTheDocument();
  });

  it('says the running version is unknown when the install carries none', async () => {
    statusReply = () => status({ current: null });
    renderBanner();

    expect(await screen.findByText(/У вас: версия неизвестна\./)).toBeInTheDocument();
  });

  it('shows nothing when there is no update, or the check failed', async () => {
    statusReply = () => status({ updateAvailable: false });
    const { container } = renderBanner();
    await vi.waitFor(() => expect(called('/update/status').length).toBe(1));

    expect(container).toBeEmptyDOMElement();
  });

  it('shows why the check failed and retries it with refresh on "Проверить снова"', async () => {
    statusReply = () => status({ updateAvailable: false, error: 'укажите адрес bridge и API-ключ' });
    const user = userEvent.setup();
    renderBanner();

    expect(await screen.findByText('укажите адрес bridge и API-ключ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Проверить снова' }));

    await vi.waitFor(() => expect(called('/update/status').some((request) => request.search.includes('refresh=1'))).toBe(true));
  });

  it('starts the update on "Обновить"', async () => {
    statusReply = () => status();
    const user = userEvent.setup();
    renderBanner();
    await screen.findByText('Доступна новая версия reports');

    await user.click(screen.getByRole('button', { name: 'Обновить' }));

    await vi.waitFor(() => expect(called('/update/apply')).toHaveLength(1));
    // sent as JSON — the server refuses anything else
    expect(called('/update/apply')[0]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('shows why the update did not start', async () => {
    statusReply = () => status();
    applyReply = () => ({ type: 'error', data: 'Обновление уже идёт — дождитесь его окончания' });
    const user = userEvent.setup();
    renderBanner();
    await screen.findByText('Доступна новая версия reports');

    await user.click(screen.getByRole('button', { name: 'Обновить' }));

    expect(await screen.findByText(/Обновление уже идёт/)).toBeInTheDocument();
  });

  it('has no "Обновить" for an install that cannot update itself, and says why', async () => {
    statusReply = () => status({ selfUpdate: { available: false, reason: 'Это git-репозиторий — reports обновляется через git pull' } });
    renderBanner();

    expect(await screen.findByText(/Обновить кнопкой нельзя: Это git-репозиторий/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обновить' })).not.toBeInTheDocument();
  });

  it('shows what a running update is doing', async () => {
    statusReply = () => status();
    progressReply = () => ({ phase: 'building', message: 'Собираю приложение…', releaseId: 'b'.repeat(64), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    renderBanner();

    expect(await screen.findByText('Обновляю reports')).toBeInTheDocument();
    expect(screen.getByText(/Собираю приложение…/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обновить' })).not.toBeInTheDocument();
  });

  it('says the update is done, and that the settings were not touched', async () => {
    statusReply = () => status({ current: { releaseId: 'b'.repeat(64), shortId: 'bbbbbbbbbbbb', version: '1.1.0' }, updateAvailable: false });
    progressReply = () => ({ phase: 'done', message: 'Обновлено: изменено 12.', releaseId: 'b'.repeat(64), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    renderBanner();

    expect(await screen.findByText('reports обновлён')).toBeInTheDocument();
    expect(screen.getByText(/Обновлено: изменено 12\. Ваши настройки и \.env не тронуты\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeInTheDocument();
  });

  it('says the update failed and the old version is back, and offers to try again', async () => {
    statusReply = () => status();
    progressReply = () => ({
      phase: 'rolled-back',
      message: 'Обновление не удалось, прежняя версия возвращена. tsc: error TS2345',
      releaseId: 'b'.repeat(64),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    renderBanner();

    expect(await screen.findByText('Обновление не удалось — прежняя версия возвращена')).toBeInTheDocument();
    expect(screen.getByText(/tsc: error TS2345/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('asks the server to check again on "Проверить снова"', async () => {
    statusReply = () => status();
    const user = userEvent.setup();
    renderBanner();
    await screen.findByText('Доступна новая версия reports');

    await user.click(screen.getByRole('button', { name: 'Проверить снова' }));

    await vi.waitFor(() => expect(called('/update/status').some((request) => request.search.includes('refresh=1'))).toBe(true));
  });

  it('can be closed until the next release comes', async () => {
    statusReply = () => status();
    const user = userEvent.setup();
    renderBanner();
    await screen.findByText('Доступна новая версия reports');

    await user.click(screen.getByRole('button', { name: /закрыть|close/i }));

    expect(screen.queryByText('Доступна новая версия reports')).not.toBeInTheDocument();
  });
});
