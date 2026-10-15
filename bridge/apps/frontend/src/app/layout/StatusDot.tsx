import styles from './AppLayout.module.css';

interface StatusDotProps {
  up: boolean;
  /** Spoken name of the thing the dot reports on. */
  subject: string;
}

// A small live-state marker next to a menu row: green = answering, red = not. It is an image with a label, not
// colour alone, so a screen reader gets the same news.
export function StatusDot({ up, subject }: StatusDotProps) {
  return (
    <span
      role="img"
      aria-label={`${subject}: ${up ? 'на связи' : 'не отвечает'}`}
      title={`${subject}: ${up ? 'на связи' : 'не отвечает'}`}
      className={`${styles.statusDot} ${up ? styles.statusUp : styles.statusDown}`}
    />
  );
}
