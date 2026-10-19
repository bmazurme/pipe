import { Flask } from '@gravity-ui/icons';
import { Icon, Text } from '@gravity-ui/uikit';

import { PageHeader } from '../widgets/PageHeader';
import styles from './ComingSoonPage.module.css';

// Lab (CAD, calculations and BOM for hardware projects) is not part of the project for now: only this placeholder is left,
// so the sidebar entry and the /lab address keep working while the section is announced as "скоро".
export function LabPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Lab" description="CAD, расчёты и BOM для хардварных проектов." />

      <div className={styles.card}>
        <span className={styles.icon}>
          <Icon data={Flask} size={28} />
        </span>
        <Text variant="header-2">
          Раздел в разработке
          <span className={styles.badge}>скоро</span>
        </Text>
        <Text color="secondary">Здесь появится, когда будет готов.</Text>
      </div>
    </div>
  );
}
