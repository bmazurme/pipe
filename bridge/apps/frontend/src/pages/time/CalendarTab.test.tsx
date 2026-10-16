import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { CalendarTab } from './CalendarTab';
import { store } from '../../store';
import { timeApi } from '../../store/api';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  store.dispatch(timeApi.util.resetApiState());
});

describe('CalendarTab list failure', () => {
  it('shows only the error alert, then the data after retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'boom' }, 500))
      .mockResolvedValue(json([]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <CalendarTab />
        </ThemeProvider>
      </Provider>,
    );

    await screen.findByText('Не удалось загрузить дни отдыха');
    expect(screen.queryByText('Январь')).toBeNull();
    expect(screen.queryByText('январь')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(screen.queryByText('Не удалось загрузить дни отдыха')).toBeNull());
    await screen.findByText('Сегодня');
  });
});
