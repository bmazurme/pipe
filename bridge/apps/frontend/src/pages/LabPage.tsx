import { Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { useTabParam } from '../shared/hooks/useTabParam';
import { PageHeader } from '../widgets/PageHeader';
import styles from './ImprovePage.module.css';
import { ProjectsTab } from './lab/ProjectsTab';
import { RouterTab } from './lab/RouterTab';
import { RunsTab } from './lab/RunsTab';
import { SchedulesTab } from './lab/SchedulesTab';

const TABS = ['projects', 'schedules', 'runs', 'router'] as const;

// Improve for somebody else's repository: the owner connects a GitHub project with their own token, and Lab hands the task (free text)
// to a worker and opens a pull request in that repository — by hand or on a nightly schedule.
export function LabPage() {
  const [activeTab, setActiveTab] = useTabParam(TABS, 'projects');

  return (
    <div className={styles.page}>
      <PageHeader title="Lab" description="Свои проекты на GitHub: задача текстом → worker → pull request в вашем репозитории. Слияние остаётся за вами." />

      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList>
          <Tab value="projects">Проекты</Tab>
          <Tab value="schedules">Расписания</Tab>
          <Tab value="runs">Запуски</Tab>
          <Tab value="router">Маршрутизатор</Tab>
        </TabList>

        <TabPanel value="projects">{activeTab === 'projects' && <ProjectsTab />}</TabPanel>
        <TabPanel value="schedules">{activeTab === 'schedules' && <SchedulesTab />}</TabPanel>
        <TabPanel value="runs">{activeTab === 'runs' && <RunsTab />}</TabPanel>
        <TabPanel value="router">{activeTab === 'router' && <RouterTab />}</TabPanel>
      </TabProvider>
    </div>
  );
}
