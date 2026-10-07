import { Alert, Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { useTabParam } from '../shared/hooks/useTabParam';
import { useGetImproveStatusQuery } from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import styles from './ImprovePage.module.css';
import { IssuesTab } from './improve/IssuesTab';
import { RunsTab } from './improve/RunsTab';
import { SchedulesTab } from './improve/SchedulesTab';

const TABS = ['issues', 'runs', 'schedules'] as const;

export function ImprovePage() {
  const [activeTab, setActiveTab] = useTabParam(TABS, 'issues');
  const { data: status } = useGetImproveStatusQuery();

  return (
    <div className={styles.page}>
      <PageHeader
        title="Improve"
        description={
          status?.repo
            ? `Самоулучшение: открытые issues ${status.repo} с меткой «${status.label}» → worker → pull request в ${status.baseBranch}. Слияние остаётся за вами.`
            : 'Самоулучшение: GitHub issues → worker → pull request.'
        }
      />

      {status && !status.configured && (
        <Alert
          theme="warning"
          view="filled"
          title="GitHub не настроен"
          message="Задайте GITHUB_REPO и LOOP_GITHUB_TOKEN на bridge (токену нужны Issues: read, Contents: write, Pull requests: write)."
        />
      )}

      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList>
          <Tab value="issues">Задачи</Tab>
          <Tab value="runs">Запуски</Tab>
          <Tab value="schedules">Расписания</Tab>
        </TabList>

        {/* Only the open tab loads: TabPanel merely hides the others with CSS. */}
        <TabPanel value="issues">{activeTab === 'issues' && <IssuesTab configured={status?.configured ?? true} />}</TabPanel>
        <TabPanel value="runs">{activeTab === 'runs' && <RunsTab />}</TabPanel>
        <TabPanel value="schedules">{activeTab === 'schedules' && <SchedulesTab />}</TabPanel>
      </TabProvider>
    </div>
  );
}
