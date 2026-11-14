import { Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { useTabParam } from '../shared/hooks/useTabParam';
import { PageHeader } from '../widgets/PageHeader';
import { AssetsTab } from './promo/AssetsTab';
import { LandingTab } from './promo/LandingTab';
import { OverviewTab } from './promo/OverviewTab';
import { PostsTab } from './promo/PostsTab';
import styles from './PromoPage.module.css';

const TABS = ['overview', 'posts', 'assets', 'landing'] as const;

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
        </TabList>

        {/* Only the open tab loads: TabPanel merely hides the others with CSS. */}
        <TabPanel value="overview">{activeTab === 'overview' && <OverviewTab onOpenTab={setActiveTab} />}</TabPanel>
        <TabPanel value="posts">{activeTab === 'posts' && <PostsTab />}</TabPanel>
        <TabPanel value="assets">{activeTab === 'assets' && <AssetsTab />}</TabPanel>
        <TabPanel value="landing">{activeTab === 'landing' && <LandingTab />}</TabPanel>
      </TabProvider>
    </div>
  );
}
