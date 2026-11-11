import type { AttentionItem, AttentionLevel } from './dashboardAttention';

// The tiles of the Dashboard in page order: what the quick-jump bar lists, and where an item of «Что требует внимания» leads.
// The id is the DOM id of the tile's root — keep it in step with the `id` each tile sets.
export interface DashboardTile {
  id: string;
  label: string;
}

export const DASHBOARD_TILES: DashboardTile[] = [
  { id: 'tile-vpn', label: 'VPN' },
  { id: 'tile-nodes', label: 'Узлы' },
  { id: 'tile-backups', label: 'Бэкапы' },
  { id: 'tile-releases', label: 'Релизы' },
  { id: 'tile-cloud', label: 'Облако' },
  { id: 'tile-channels', label: 'Каналы' },
  { id: 'tile-boards', label: 'Платы' },
  { id: 'tile-nas', label: 'NAS' },
  { id: 'tile-ups', label: 'ИБП' },
  { id: 'tile-router', label: 'Роутер' },
  { id: 'tile-github', label: 'GitHub' },
];

/** The tile an attention item is about (`board:white` → the boards tile), or null for an id nobody knows. */
export function tileOfAttention(id: string): string | null {
  const kind = id.split(':')[0];

  switch (kind) {
    case 'vpn':
    case 'vpn-list':
      return 'tile-vpn';
    case 'nodes':
      return 'tile-nodes';
    case 'backup':
      return 'tile-backups';
    case 'release':
      return 'tile-releases';
    case 'cloud':
      return 'tile-cloud';
    case 'channels':
      return 'tile-channels';
    case 'board':
      return 'tile-boards';
    case 'nas':
      return 'tile-nas';
    case 'ups':
      return 'tile-ups';
    case 'router':
      return 'tile-router';
    default:
      return null;
  }
}

/** The worst level per tile; a tile that is not in the result has nothing to report. */
export function tileLevels(items: AttentionItem[]): Record<string, AttentionLevel> {
  const levels: Record<string, AttentionLevel> = {};

  for (const item of items) {
    const tile = tileOfAttention(item.id);

    if (!tile) continue;
    if (levels[tile] !== 'bad') levels[tile] = item.level;
  }

  return levels;
}
