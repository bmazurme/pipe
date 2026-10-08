import { useEffect } from 'react';
import { Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { useTabParam } from '../shared/hooks/useTabParam';
import { useAppSelector } from '../store/hooks';
import { TIME_YEAR_STORAGE_KEY, timeYearSelector } from '../store/slices';
import { PageHeader } from '../widgets/PageHeader';
import { CalendarTab } from './time/CalendarTab';
import { DashboardTab } from './time/DashboardTab';
import { DayOffsTab } from './time/DayOffsTab';
import { ReportTab } from './time/ReportTab';
import styles from './TimePage.module.css';

const TABS = ['dashboard', 'calendar', 'day-offs', 'report'] as const;

export function TimePage() {
  const [activeTab, setActiveTab] = useTabParam(TABS, 'dashboard');

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
          <Tab value="dashboard">Дашборд</Tab>
          <Tab value="calendar">Календарь</Tab>
          <Tab value="day-offs">Day off</Tab>
          <Tab value="report">Отчёт</Tab>
        </TabList>

        {/* TabPanel only hides an inactive panel with CSS — it still mounts
            its children. Rendering the active tab alone keeps opening this
            page from building twelve calendars and firing a report request
            for a period the user isn't looking at. */}
        <TabPanel value="dashboard">{activeTab === 'dashboard' && <DashboardTab />}</TabPanel>

        <TabPanel value="calendar">{activeTab === 'calendar' && <CalendarTab />}</TabPanel>

        <TabPanel value="day-offs">{activeTab === 'day-offs' && <DayOffsTab />}</TabPanel>

        <TabPanel value="report">{activeTab === 'report' && <ReportTab />}</TabPanel>
      </TabProvider>
    </div>
  );
}
