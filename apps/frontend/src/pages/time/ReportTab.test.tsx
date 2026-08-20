import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ReportTab } from './ReportTab';
import { store } from '../../store';

const ENTRIES = [
  { id: 1, year: 2026, month: 8, taskName: 'Задача 10', status: 'В работе', hours: 4 },
  { id: 2, year: 2026, month: 8, taskName: 'Задача 2', status: 'Готово', hours: 12 },
  { id: 3, year: 2026, month: 8, taskName: 'Аудит', status: 'В работе', hours: 7 },
];

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ReportTab />
      </ThemeProvider>
    </Provider>,
  );
}

/** Task names in the order the table currently renders them. */
function renderedTaskNames(): string[] {
  const [body] = screen.getAllByRole('rowgroup').slice(1);

  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '');
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ENTRIES), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

describe('ReportTab', () => {
  it('renders rows in the imported order until a column is clicked', async () => {
    renderTab();

    await screen.findByText('Задача 10');
    expect(renderedTaskNames()).toEqual(['Задача 10', 'Задача 2', 'Аудит']);
  });

  it('cycles a column through ascending, descending and back to imported order', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Задача 10');

    const hours = screen.getByRole('button', { name: /Часы/ });

    await user.click(hours);
    expect(renderedTaskNames()).toEqual(['Задача 10', 'Аудит', 'Задача 2']);

    await user.click(hours);
    expect(renderedTaskNames()).toEqual(['Задача 2', 'Аудит', 'Задача 10']);

    await user.click(hours);
    expect(renderedTaskNames()).toEqual(['Задача 10', 'Задача 2', 'Аудит']);
  });

  it('exposes the sort state to assistive tech on the sorted column only', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Задача 10');

    await user.click(screen.getByRole('button', { name: /Задача/ }));

    const [taskHeader, statusHeader] = screen.getAllByRole('columnheader');
    expect(taskHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(statusHeader).toHaveAttribute('aria-sort', 'none');
  });

  it('refetches the period when the refresh button is used', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Задача 10');

    const callsBefore = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Обновить данные' }));

    await waitFor(() =>
      expect(
        (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore),
    );
  });
});
