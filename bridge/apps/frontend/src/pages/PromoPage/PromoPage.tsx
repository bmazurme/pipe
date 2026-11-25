import { Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { useTabParam } from '../../shared/hooks/useTabParam';
import { PageHeader } from '../../widgets/PageHeader';
import { AssetsTab } from './AssetsTab';
import { LandingTab } from './LandingTab';
import { OverviewTab } from './OverviewTab';
import { PostsTab } from './PostsTab';
import { StatsTab } from './StatsTab';
import styles from './PromoPage.module.css';

const TABS = ['overview', 'posts', 'assets', 'landing', 'stats'] as const;

// The promotion dashboard: the project's channels (Telegram, YouTube, Instagram) and the landing page in one place.
export function PromoPage() {
  const [activeTab, setActiveTab] = useTabParam(TABS, 'overview');

  return (
    <div className={styles.page}>
      <PageHeader
        title="Промо"
        description="Каналы проекта (Telegram, YouTube, Instagram) и лендинг: очередь постов, файлы, релизы сайта."
      />

      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList>
          <Tab value="overview">Обзор</Tab>
          <Tab value="posts">Посты</Tab>
          <Tab value="assets">Файлы</Tab>
          <Tab value="landing">Лендинг</Tab>
          <Tab value="stats">Статистика</Tab>
        </TabList>

        {/* Only the open tab loads: TabPanel merely hides the others with CSS. */}
        <TabPanel value="overview">{activeTab === 'overview' && <OverviewTab onOpenTab={setActiveTab} />}</TabPanel>
        <TabPanel value="posts">{activeTab === 'posts' && <PostsTab />}</TabPanel>
        <TabPanel value="assets">{activeTab === 'assets' && <AssetsTab />}</TabPanel>
        <TabPanel value="landing">{activeTab === 'landing' && <LandingTab />}</TabPanel>
        <TabPanel value="stats">{activeTab === 'stats' && <StatsTab />}</TabPanel>
      </TabProvider>
    </div>
  );
}
