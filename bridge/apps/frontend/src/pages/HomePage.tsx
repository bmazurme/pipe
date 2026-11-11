import { ArrowRight, Person } from '@gravity-ui/icons';
import { Icon, Text } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';

import { useAuth } from '../app/providers/AuthProvider';
import { groupedServices, type ServiceLink, SOON_SERVICES } from '../shared/config/services';
import { PageHeader } from '../widgets/PageHeader';
import styles from './HomePage.module.css';

function ServiceCard({ service }: { service: ServiceLink }) {
  return (
    <Link to={service.path} className={styles.card}>
      <span className={styles.cardIcon}>
        <Icon data={service.icon} size={20} />
      </span>
      <span className={styles.cardBody}>
        <Text variant="subheader-1">
          {service.title}
          {service.soon && <span className={styles.soonBadge}>скоро</span>}
        </Text>
        <Text color="secondary" variant="body-1">
          {service.description}
        </Text>
      </span>
      <Icon data={ArrowRight} size={16} className={styles.cardArrow} />
    </Link>
  );
}

export function HomePage() {
  const { user } = useAuth();

  return (
    <div className={styles.page}>
      <PageHeader title="Добро пожаловать" description={user?.username} />

      {/* Real <Link>s rather than clickable cards: keyboard focus, middle-click
          and "open in new tab" all come for free, and the old copy pointed at
          a sidebar that doesn't exist on mobile. The sections are the sidebar's own, in its order: one flat grid of twenty cards had no
          order to find anything by. */}
      {groupedServices(user?.isOwner).map((section) => (
        <section key={section.group} aria-labelledby={`home-${section.group}`} className={styles.section}>
          <h2 id={`home-${section.group}`} className={styles.sectionTitle}>
            {section.title}
            <span className={styles.sectionCount}>{section.items.length}</span>
          </h2>
          <div className={styles.grid}>
            {section.items.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
        </section>
      ))}

      <section aria-labelledby="home-account" className={styles.section}>
        <h2 id="home-account" className={styles.sectionTitle}>
          Аккаунт
        </h2>
        <div className={styles.grid}>
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
        </div>
      </section>

      {SOON_SERVICES.length > 0 && (
        <section aria-labelledby="home-soon" className={styles.section}>
          <h2 id="home-soon" className={styles.sectionTitle}>
            Скоро
          </h2>
          <div className={styles.grid}>
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
        </section>
      )}
    </div>
  );
}
