import type { DashboardBoardMetrics, DashboardDeploy, DashboardNas } from '../../store/api';

// What the Dashboard header says in one line, and the list under it: everything on the page that is not fine, from every tile - so the
// answer to "is anything wrong?" does not need scrolling through them. Pure; the page feeds it what its queries returned.

export type AttentionLevel = 'bad' | 'warn';

export interface AttentionItem {
  id: string;
  level: AttentionLevel;
  text: string;
}

export interface AttentionInput {
  vpnDown: boolean;
  vpnListError: boolean;
  nodesError: boolean;
  /** Swarm nodes that are not ready, by label. */
  nodesDown: string[];
  backupIssue: boolean;
  boards: DashboardBoardMetrics[];
  nas: DashboardNas[];
  /** The newest report of the deploying board, if any. */
  lastDeploy: DashboardDeploy | null;
}

const shortHost = (host: string) => host.replace(/^ubuntu-/, '');

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.vpnDown) items.push({ id: 'vpn', level: 'bad', text: 'VPN: нет связи с активным подключением' });
  if (input.vpnListError) items.push({ id: 'vpn-list', level: 'bad', text: 'VPN: не удалось загрузить список подключений' });
  if (input.nodesError) items.push({ id: 'nodes', level: 'bad', text: 'Узлы: не удалось получить состояние кластера' });
  else if (input.nodesDown.length > 0) items.push({ id: 'nodes', level: 'bad', text: `Узлы не в строю: ${input.nodesDown.join(', ')}` });
  if (input.backupIssue) items.push({ id: 'backup', level: 'bad', text: 'Бэкап: нет свежей копии базы' });

  for (const board of input.boards) {
    if (board.status === 'ok') continue;

    items.push({ id: `board:${board.host}`, level: board.status, text: `Плата ${shortHost(board.host)}: ${board.reasons[0] ?? 'есть замечания'}${board.reasons.length > 1 ? ` (и ещё ${board.reasons.length - 1})` : ''}` });
  }

  for (const nas of input.nas) {
    if (nas.status === 'ok') continue;

    items.push({ id: `nas:${nas.host}`, level: nas.status, text: `NAS: ${nas.reasons[0] ?? 'есть замечания'}${nas.reasons.length > 1 ? ` (и ещё ${nas.reasons.length - 1})` : ''}` });
  }

  if (input.lastDeploy && input.lastDeploy.result !== 'deployed') {
    const prs = input.lastDeploy.prNumbers.length ? ` (${input.lastDeploy.prNumbers.map((pr) => `#${pr}`).join(', ')})` : '';

    items.push({
      id: 'release',
      level: 'bad',
      text: `Релиз ${input.lastDeploy.sha.slice(0, 7)}${prs} ${input.lastDeploy.result === 'rolled_back' ? 'откатился' : 'не поднялся'} — автоматика на паузе`,
    });
  }

  // The worst first.
  return items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
}

export function summarize(items: AttentionItem[]): { label: string; theme: 'success' | 'warning' | 'danger' } {
  const bad = items.filter((item) => item.level === 'bad').length;
  const warn = items.length - bad;

  if (bad > 0) return { label: `Проблем: ${bad}`, theme: 'danger' };
  if (warn > 0) return { label: `Замечаний: ${warn}`, theme: 'warning' };

  return { label: 'Всё в порядке', theme: 'success' };
}
