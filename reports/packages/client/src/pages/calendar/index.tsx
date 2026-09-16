import type { DateType } from '@reports/shared';

import MyCalendar from '../../components/calendar/calendar';

type CalendarPageProps = {
  data: DateType;
  year: string;
}

function CalendarPage({ data, year }: CalendarPageProps) {
  return (
    <MyCalendar
      data={data}
      year={year}
    />
  )
}

export default CalendarPage;
