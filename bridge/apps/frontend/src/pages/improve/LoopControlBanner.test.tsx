import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { improveApi } from '../../store/api';
import { LoopControlBanner } from './LoopControlBanner';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let state = { paused: false, reason: null as string | null, pausedBy: null as string | null, pausedAt: null as string | null };
let sent: Array<{ method: string; path: string; body: unknown }> = [];

beforeEach(() => {
  sent = [];
  state = { paused: false, reason: null, pausedBy: null, pausedAt: null };
  store.dispatch(improveApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') {
        sent.push({ method: request.method, path, body: await request.clone().json().catch(() => undefined) });
        state = path.endsWith('/pause')
          ? { paused: true, reason: 'вручную', pausedBy: 'owner', pausedAt: new Date().toISOString() }
          : { paused: false, reason: null, pausedBy: null, pausedAt: null };
      }

      return json(state);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const renderBanner = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <LoopControlBanner />
      </ThemeProvider>
    </Provider>,
  );

describe('LoopControlBanner', () => {
  it('offers a pause while running, and shows the pause with who and why once on', async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(await screen.findByRole('button', { name: 'Поставить автоматику на паузу' }));

    expect(await screen.findByText('Автоматика на паузе')).toBeTruthy();
    expect(screen.getByText('вручную')).toBeTruthy();
    expect(screen.getByText(/остановлено вами/)).toBeTruthy();
    expect(sent).toContainEqual({ method: 'POST', path: 'loop/control/pause', body: {} });
  });

  it('explains a pause made by a rolled back release and resumes with one click', async () => {
    state = { paused: true, reason: 'версия 9781a0d откатена', pausedBy: 'deploy', pausedAt: new Date().toISOString() };
    const user = userEvent.setup();
    renderBanner();

    expect(await screen.findByText('версия 9781a0d откатена')).toBeTruthy();
    expect(screen.getByText(/остановил откат релиза/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Продолжить' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'POST', path: 'loop/control/resume', body: undefined }));
    expect(await screen.findByRole('button', { name: 'Поставить автоматику на паузу' })).toBeTruthy();
  });
});
