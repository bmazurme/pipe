import { describe, expect, it } from 'vitest';

import type { DashboardBoardMetrics, DashboardDeploy, DashboardNas } from '../../store/api';
import { type AttentionInput, buildAttention, summarize } from './dashboardAttention';

const calm: AttentionInput = { vpnDown: false, vpnListError: false, nodesError: false, nodesDown: [], backupIssue: false, boards: [], nas: [], lastDeploy: null };

const board = (host: string, status: DashboardBoardMetrics['status'], reasons: string[] = []): DashboardBoardMetrics => ({ host, at: '2026-10-30T12:00:00Z', status, reasons, data: {}, series: [] });
const nas = (status: DashboardNas['status'], reasons: string[] = []): DashboardNas => ({ host: 'MyCloudEX2Ultra', reportedAt: '2026-10-30T12:00:00Z', status, reasons, data: { uptimeSec: 1, backup: { snapshots: 1, bytes: 1 }, raid: { summary: '', degraded: false, syncing: false }, volume: { totalBytes: 1, usedBytes: 1 }, disks: [] } });
const deploy = (result: DashboardDeploy['result'], prNumbers: number[] = []): DashboardDeploy => ({ sha: '9781a0d'.padEnd(40, 'a'), previousSha: null, result, detail: null, prNumbers, at: '2026-10-30T12:00:00Z' });

describe('buildAttention', () => {
  it('is empty when everything is fine', () => {
    expect(buildAttention({ ...calm, boards: [board('ubuntu-red', 'ok')], nas: [nas('ok')], lastDeploy: deploy('deployed') })).toEqual([]);
  });

  it('names what is wrong in each tile, the worst first', () => {
    const items = buildAttention({
      ...calm,
      vpnDown: true,
      nodesDown: ['red'],
      backupIssue: true,
      boards: [board('ubuntu-blue', 'warn', ['Процессор 66 °C']), board('ubuntu-green', 'bad', ['Нет данных 12 мин — плата выключена', 'второе'])],
      nas: [nas('warn', ['Копия бэкапа устарела: 27 ч'])],
      lastDeploy: deploy('rolled_back', [41, 42]),
    });

    expect(items.map((item) => [item.level, item.text])).toEqual([
      ['bad', 'VPN: нет связи с активным подключением'],
      ['bad', 'Узлы не в строю: red'],
      ['bad', 'Бэкап: нет свежей копии базы'],
      ['bad', 'Плата green: Нет данных 12 мин — плата выключена (и ещё 1)'],
      ['bad', 'Релиз 9781a0d (#41, #42) откатился — автоматика на паузе'],
      ['warn', 'Плата blue: Процессор 66 °C'],
      ['warn', 'NAS: Копия бэкапа устарела: 27 ч'],
    ]);
  });

  it('says a release that never came up did not come up, and ignores a release that went out', () => {
    expect(buildAttention({ ...calm, lastDeploy: deploy('failed') })[0].text).toContain('не поднялся');
    expect(buildAttention({ ...calm, lastDeploy: deploy('deployed') })).toEqual([]);
  });

  it('reports a failed load of the cluster state instead of an empty list of nodes', () => {
    expect(buildAttention({ ...calm, nodesError: true }).map((item) => item.text)).toEqual(['Узлы: не удалось получить состояние кластера']);
  });
});

describe('summarize', () => {
  it('counts problems before remarks, and is calm when there are none', () => {
    expect(summarize([])).toEqual({ label: 'Всё в порядке', theme: 'success' });
    expect(summarize([{ id: 'a', level: 'warn', text: '' }])).toEqual({ label: 'Замечаний: 1', theme: 'warning' });
    expect(
      summarize([
        { id: 'a', level: 'warn', text: '' },
        { id: 'b', level: 'bad', text: '' },
        { id: 'c', level: 'bad', text: '' },
      ]),
    ).toEqual({ label: 'Проблем: 2', theme: 'danger' });
  });
});
