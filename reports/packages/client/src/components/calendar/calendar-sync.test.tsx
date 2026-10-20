import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, Toaster, ToasterComponent, ToasterProvider } from '@gravity-ui/uikit';
import type { DateType } from '@reports/shared';

const api = vi.hoisted(() => ({
  send: vi.fn(),
  receive: vi.fn(),
}));

vi.mock('../../store/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAddOffDaysMutation: () => [vi.fn(), { isLoading: false }],
  useRemoveOffDayMutation: () => [vi.fn(), { isLoading: false }],
  useImportDayOffsMutation: () => [api.receive, { isLoading: false }],
  useSendDayOffsMutation: () => [api.send, { isLoading: false }],
}));

import { store } from '../../store';
import MyCalendar from './calendar';

const data: DateType = { calendar: {} as DateType['calendar'], holidays: [], shortDays: [], badDays: [], offDays: ['2026-03-10'] };

const renderCalendar = () => {
  const toaster = new Toaster();

  return render(
    <Provider store={store}>
      <MemoryRouter>
        <ThemeProvider theme="light">
          <ToasterProvider toaster={toaster}>
            <MyCalendar data={data} year="2026" />
            <ToasterComponent />
          </ToasterProvider>
        </ThemeProvider>
      </MemoryRouter>
    </Provider>,
  );
};

const openDaysOffTab = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('tab', { name: /Отгулы/ }));
};

beforeEach(() => {
  api.send.mockReset();
  api.receive.mockReset();
});

describe('days off sync with bridge', () => {
  it('"Получить" pulls the year from bridge', async () => {
    api.receive.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    const user = userEvent.setup();
    renderCalendar();
    await openDaysOffTab(user);

    await user.click(screen.getByRole('button', { name: /Получить/ }));

    expect(api.receive).toHaveBeenCalledWith('2026');
    expect(await screen.findByText('Данные импортированы')).toBeInTheDocument();
  });

  it('"Отправить" sends the year to bridge and says what bridge did with it', async () => {
    api.send.mockReturnValue({ unwrap: () => Promise.resolve({ year: 2026, created: 3, updated: 1, unchanged: 5 }) });
    const user = userEvent.setup();
    renderCalendar();
    await openDaysOffTab(user);

    await user.click(screen.getByRole('button', { name: /Отправить/ }));

    expect(api.send).toHaveBeenCalledWith('2026');
    expect(await screen.findByText('Данные отправлены в bridge')).toBeInTheDocument();
    expect(screen.getByText('Добавлено: 3, обновлено: 1, без изменений: 5')).toBeInTheDocument();
  });

  it('"Отправить" shows bridge\'s refusal instead of pretending it worked', async () => {
    api.send.mockReturnValue({ unwrap: () => Promise.reject(new Error('Bridge API вернул ошибку 401')) });
    const user = userEvent.setup();
    renderCalendar();
    await openDaysOffTab(user);

    await user.click(screen.getByRole('button', { name: /Отправить/ }));

    await waitFor(() => expect(screen.getByText('Не удалось отправить данные')).toBeInTheDocument());
    expect(screen.queryByText('Данные отправлены в bridge')).not.toBeInTheDocument();
  });
});
