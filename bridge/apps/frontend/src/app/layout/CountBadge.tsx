import styles from './AppLayout.module.css';

interface CountBadgeProps {
  total: number;
  urgent: number;
}

// How many «Решения» wait, drawn on their row: red when at least one is urgent. The label says it in words, so
// colour is not the only carrier.
export function CountBadge({ total, urgent }: CountBadgeProps) {
  const label = urgent > 0 ? `${total} ждут решения, ${urgent} срочно` : `${total} ждут решения`;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`${styles.countBadge} ${urgent > 0 ? styles.countBadgeUrgent : ''}`}
    >
      {total}
    </span>
  );
}
