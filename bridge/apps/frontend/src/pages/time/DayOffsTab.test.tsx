import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('DayOffsTab weekday', () => {
  it('shows the weekday next to each date, weekends told apart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json([
          { id: 1, date: '2026-10-19', type: 'off' },
          { id: 2, date: '2026-10-24', type: 'compensatory' },
        ]),
      ),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <DayOffsTab />
        </ThemeProvider>
      </Provider>,
    );

    const monday = await screen.findByLabelText('День недели: Пн');
    const saturday = screen.getByLabelText('День недели: Сб');

    expect(monday).toHaveTextContent('Пн');
    expect(saturday).toHaveTextContent('Сб');
    // A weekend is drawn in the danger colour, a working day in the quiet one.
    expect(saturday.className).toMatch(/color_danger/);
    expect(monday.className).toMatch(/color_secondary/);
  });
});

describe('DayOffsTab add dialog', () => {
  // The page has its own "Добавить" button; the dialog's one is the one inside the dialog.
  const applyButton = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Добавить' });

  async function openDialog() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json([])));
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <DayOffsTab />
        </ThemeProvider>
      </Provider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Добавить' }));
    await screen.findByRole('dialog');

    return user;
  }

  it('starts with nothing picked: the button is off and the hint says how to choose one day', async () => {
    await openDialog();

    expect(applyButton()).toBeDisabled();
    expect(screen.getByText(/Для одного дня выберите одну и ту же дату/)).toBeInTheDocument();
  });

  it('explains what the chosen kind does to the month', async () => {
    const user = await openDialog();

    expect(screen.getByText(/Отпуск, отгул или больничный/)).toBeInTheDocument();

    await user.click(screen.getByText('Короткий день'));
    expect(screen.getByText(/норма часов за месяц уменьшается на 1 ч/)).toBeInTheDocument();

    await user.click(screen.getByText('Рабочий выходной'));
    expect(screen.getByText(/по переносу стали рабочими/)).toBeInTheDocument();
  });

  it('forgets the previous choice when opened again', async () => {
    const user = await openDialog();

    await user.click(screen.getByText('Праздник'));
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText(/Отпуск, отгул или больничный/)).toBeInTheDocument();
  });
});
