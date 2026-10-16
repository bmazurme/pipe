import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { DayOffsTab } from './DayOffsTab';
import { store } from '../../store';
import { timeApi } from '../../store/api';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  store.dispatch(timeApi.util.resetApiState());
});

describe('DayOffsTab list failure', () => {
  it('shows only the error alert, then the data after retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'boom' }, 500))
      .mockResolvedValue(json([{ id: 1, date: '2026-05-01', type: 'holiday' }]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <DayOffsTab />
        </ThemeProvider>
      </Provider>,
    );

    await screen.findByText('Не удалось загрузить дни отдыха');
    expect(screen.queryByText(/отгулов нет/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    await screen.findByRole('button', { name: /Удалить/ });
    expect(screen.queryByText('Не удалось загрузить дни отдыха')).toBeNull();
  });
});
