import { useState } from 'react';
import { Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { PageHeader } from '../widgets/PageHeader';
import { CalendarTab } from './time/CalendarTab';
import { DayOffsTab } from './time/DayOffsTab';
import styles from './TimePage.module.css';

export function TimePage() {
  const [activeTab, setActiveTab] = useState('calendar');

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
        </TabList>

        <TabPanel value="calendar">
          <CalendarTab />
        </TabPanel>

        <TabPanel value="day-offs">
          <DayOffsTab />
        </TabPanel>
      </TabProvider>
    </div>
  );
}
