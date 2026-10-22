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

describe('CalendarTab day type labels', () => {
  it('names the type on the day buttons and leaves plain days bare', async () => {
    const year = new Date().getFullYear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json([
          { id: 1, date: `${year}-03-10`, type: 'holiday' },
          { id: 2, date: `${year}-03-12`, type: 'short' },
        ]),
      ),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <CalendarTab />
        </ThemeProvider>
      </Provider>,
    );

    const holiday = await screen.findByRole('button', { name: /Праздник$/ });
    const short = screen.getByRole('button', { name: /Короткий день$/ });
    expect(holiday.title).toBe('Праздник');
    expect(short.title).toBe('Короткий день');
    expect(screen.getAllByRole('button', { name: /Праздник/ })).toHaveLength(1);

    const plain = screen.getAllByRole('button').filter((b) => !b.title && b.dataset.baseLabel);
    expect(plain.length).toBeGreaterThan(0);
    for (const b of plain) expect(b.getAttribute('aria-label')).toBe(b.dataset.baseLabel);
  });
});
