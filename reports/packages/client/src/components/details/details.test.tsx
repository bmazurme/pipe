import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import type { DateType, MonthType } from '@reports/shared';

import Details from './details';

const emptyMonth: MonthType = {
  allDays: 0,
  holidays: 0,
  weekends: 0,
  offDays: 0,
  shortDays: 0,
  workDays: 0,
  hours: 0,
};

const buildData = (hours: number): DateType => ({
  calendar: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [String(i + 1), { ...emptyMonth, hours }]),
  ) as DateType['calendar'],
  holidays: [],
  shortDays: [],
  badDays: [],
  offDays: [],
});

const renderDetails = (props: Parameters<typeof Details>[0]) =>
  render(
    <ThemeProvider theme="light">
      <Details {...props} />
    </ThemeProvider>,
  );

describe('Details', () => {
  it('shows the tracked hours against the monthly norm', () => {
    renderDetails({
      month: '1',
      total: 100,
      issues: 5,
      closed: 2,
      data: buildData(160),
    });

    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('из 160 ч нормы')).toBeInTheDocument();
    expect(screen.getByText('Осталось 60 ч')).toBeInTheDocument();
    expect(screen.queryByText('Превышение нормы часов')).not.toBeInTheDocument();
  });

  it('warns when total hours exceed the month limit', () => {
    renderDetails({
      month: '1',
      total: 200,
      issues: 5,
      closed: 2,
      data: buildData(160),
    });

    expect(screen.getByText('Превышение нормы часов')).toBeInTheDocument();
    expect(screen.getByText('Превышение на 40 ч')).toBeInTheDocument();
  });

  it('breaks issues down into closed and open', () => {
    renderDetails({
      month: '1',
      total: 10,
      issues: 5,
      closed: 2,
      data: buildData(160),
    });

    const openTile = screen.getByText('В работе').parentElement;

    expect(openTile).toHaveTextContent('3');
  });
});
