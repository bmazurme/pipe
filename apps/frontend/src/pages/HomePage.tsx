import { ArrowRight, Person } from '@gravity-ui/icons';
import { Icon, Text } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';

import { useAuth } from '../app/providers/AuthProvider';
import { SERVICES, SOON_SERVICES } from '../shared/config/services';
import { PageHeader } from '../widgets/PageHeader';
import styles from './HomePage.module.css';

export function HomePage() {
  const { user } = useAuth();

  return (
    <div className={styles.page}>
      <PageHeader title="Добро пожаловать" description={user?.username} />

      {/* Real <Link>s rather than clickable cards: keyboard focus, middle-click
          and "open in new tab" all come for free, and the old copy pointed at
          a sidebar that doesn't exist on mobile. */}
      <div className={styles.grid}>
        {SERVICES.map((service) => (
          <Link key={service.id} to={service.path} className={styles.card}>
            <span className={styles.cardIcon}>
              <Icon data={service.icon} size={20} />
            </span>
            <span className={styles.cardBody}>
              <Text variant="subheader-1">{service.title}</Text>
              <Text color="secondary" variant="body-1">
                {service.description}
              </Text>
            </span>
            <Icon data={ArrowRight} size={16} className={styles.cardArrow} />
          </Link>
        ))}

        <Link to="/profile" className={styles.card}>
          <span className={styles.cardIcon}>
            <Icon data={Person} size={20} />
          </span>
          <span className={styles.cardBody}>
            <Text variant="subheader-1">Профиль</Text>
            <Text color="secondary" variant="body-1">
              Учётная запись, активные сеансы и ключи интеграций.
            </Text>
          </span>
          <Icon data={ArrowRight} size={16} className={styles.cardArrow} />
        </Link>

        {SOON_SERVICES.map((service) => (
          <div key={service.id} className={`${styles.card} ${styles.cardSoon}`} aria-disabled>
            <span className={styles.cardIcon}>
              <Icon data={service.icon} size={20} />
            </span>
            <span className={styles.cardBody}>
              <Text variant="subheader-1">
                {service.title}
                <span className={styles.soonBadge}>скоро</span>
              </Text>
              <Text color="secondary" variant="body-1">
                {service.description}
              </Text>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
