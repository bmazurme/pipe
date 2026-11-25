import { PageHeader } from '../../widgets/PageHeader';
import { ReportsReleaseSection } from './ReportsReleaseSection';
import { ReportsSettingsBackupSection } from './ReportsSettingsBackupSection';
import styles from './ReportsPage.module.css';

export function ReportsPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Reports"
        description="Последняя версия reports с GitHub и бэкап его настроек на bridge."
      />

      <ReportsReleaseSection />
      <ReportsSettingsBackupSection />
    </div>
  );
}
