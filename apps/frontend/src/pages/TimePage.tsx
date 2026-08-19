import { useEffect, useState } from 'react';
import { Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { useAppSelector } from '../store/hooks';
import { TIME_YEAR_STORAGE_KEY, timeYearSelector } from '../store/slices';
import { PageHeader } from '../widgets/PageHeader';
import { CalendarTab } from './time/CalendarTab';
import { DayOffsTab } from './time/DayOffsTab';
import { ReportTab } from './time/ReportTab';
import styles from './TimePage.module.css';

export function TimePage() {
  const [activeTab, setActiveTab] = useState('calendar');

  // Persists the calendar/day-offs year across reloads — lives here (rather
  // than in the slice reducer) to keep the reducer a pure state update, and
  // above the tabs so it stays mounted regardless of which one is active.
  const year = useAppSelector(timeYearSelector);
  useEffect(() => {
    try {
      window.localStorage.setItem(TIME_YEAR_STORAGE_KEY, String(year));
    } catch {
      // Storage unavailable (e.g. private browsing) — year still works for
      // this session, it just won't survive a reload.
    }
  }, [year]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Time"
        description="Рабочий календарь и учёт отгулов, отпусков и больничных."
      />

      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList>
          <Tab value="calendar">Календарь</Tab>
          <Tab value="day-offs">Day off</Tab>
          <Tab value="report">Отчёт</Tab>
        </TabList>

        <TabPanel value="calendar">
          <CalendarTab />
        </TabPanel>

        <TabPanel value="day-offs">
          <DayOffsTab />
        </TabPanel>

        <TabPanel value="report">
          <ReportTab />
        </TabPanel>
      </TabProvider>
    </div>
  );
}
