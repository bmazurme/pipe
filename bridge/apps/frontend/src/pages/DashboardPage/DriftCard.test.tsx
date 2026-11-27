import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { boardsApi } from '../../store/api';
import { DriftCard } from './DriftCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <DriftCard />
      </ThemeProvider>
    </Provider>,
  );

beforeEach(() => store.dispatch(boardsApi.util.resetApiState()));
afterEach(() => vi.unstubAllGlobals());

describe('DriftCard', () => {
  it('says all is well when nothing has drifted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: 'ok', items: [] })));
    renderCard();

    expect(await screen.findByText('всё как должно быть')).toBeTruthy();
    expect(screen.queryByText(/в сутки в Telegram/)).toBeNull();
  });

  it('lists what drifted, with the board shortened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          status: 'bad',
          items: [
            { id: 'ubuntu-red:worker-down:x', level: 'bad', subject: 'ubuntu-red', text: 'red: контейнер воркера не запущен' },
            { id: 'pi-blue:worker-version:pi-blue', level: 'warn', subject: 'pi-blue', text: 'воркер pi-blue на версии 0.1.0, в парке уже 0.2.0' },
          ],
        }),
      ),
    );
    renderCard();

    expect(await screen.findByText('нужно вмешательство')).toBeTruthy();
    expect(screen.getByText('red: контейнер воркера не запущен')).toBeTruthy();
    expect(screen.getByText('воркер pi-blue на версии 0.1.0, в парке уже 0.2.0')).toBeTruthy();
    expect(screen.getByText(/в сутки в Telegram/)).toBeTruthy();
  });

  it('says it could not load instead of claiming all is well', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'boom' }, 500)));
    renderCard();

    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });
});
