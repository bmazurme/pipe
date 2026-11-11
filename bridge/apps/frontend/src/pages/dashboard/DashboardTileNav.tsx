import type { MouseEvent } from 'react';

import type { AttentionLevel } from './dashboardAttention';
import { DASHBOARD_TILES } from './dashboardTiles';
import styles from './DashboardTileNav.module.css';

interface DashboardTileNavProps {
  /** Worst level per tile id; absent = nothing to report. */
  levels: Record<string, AttentionLevel>;
  /** False while the tiles are still loading: nothing is claimed about them yet (no green dot). */
  ready: boolean;
}

const LEVEL_TEXT: Record<AttentionLevel | 'ok', string> = { bad: 'проблема', warn: 'замечания', ok: 'в порядке' };

// A bar that stays at the top of the page: one chip per tile, with its state as a dot, jumping to it. The page is five screens
// tall on a phone, and «is anything wrong, and where?» should not need scrolling through them.
export function DashboardTileNav({ levels, ready }: DashboardTileNavProps) {
  const jump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);

    if (!target) return;

    event.preventDefault();
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    // The URL keeps the place, so a reload or a shared link lands on the tile; replaceState does not add history entries per chip.
    window.history.replaceState(null, '', `#${id}`);
  };

  return (
    <nav className={styles.bar} aria-label="Плитки дашборда">
      {DASHBOARD_TILES.map((tile) => {
        const level: AttentionLevel | 'ok' | null = levels[tile.id] ?? (ready ? 'ok' : null);

        return (
          <a key={tile.id} href={`#${tile.id}`} className={styles.chip} onClick={(event) => jump(event, tile.id)}>
            {level && <span className={`${styles.dot} ${styles[level]}`} role="img" aria-label={LEVEL_TEXT[level]} />}
            {tile.label}
          </a>
        );
      })}
    </nav>
  );
}
