import { assessNas, NasData } from './nas';

const NOW = new Date('2026-10-30T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const healthy = (over: Partial<NasData> = {}): NasData => ({
  host: 'MyCloudEX2Ultra',
  uptimeSec: 100_000,
  backup: {
    createdAt: hoursAgo(10).toISOString(),
    latest: '20261030T000207Z',
    snapshots: 3,
    bytes: 100_000_000,
  },
  raid: { summary: 'md1 [UU] md0 [UU]', degraded: false, syncing: false },
  volume: { totalBytes: 1_000, usedBytes: 190 },
  disks: [
    {
      name: 'sda',
      healthPassed: true,
      reallocated: 0,
      pending: 0,
      uncorrectable: 0,
      tempC: 36,
      powerOnHours: 36_848,
    },
    {
      name: 'sdb',
      healthPassed: true,
      reallocated: 0,
      pending: 0,
      uncorrectable: 0,
      tempC: 37,
      powerOnHours: 36_820,
    },
  ],
  ...over,
});

describe('assessNas', () => {
  it('is fine for a fresh report with a clean RAID, clean disks and a recent copy', () => {
    expect(assessNas(healthy(), minutesAgo(5), NOW)).toEqual({
      status: 'ok',
      reasons: [],
    });
  });

  it('is bad, and says nothing else, once the reports stopped coming', () => {
    const result = assessNas(
      healthy({ raid: { summary: 'x', degraded: true, syncing: false } }),
      minutesAgo(45),
      NOW,
    );

    expect(result.status).toBe('bad');
    expect(result.reasons).toEqual([
      'NAS не присылает отчёт 45 мин — выключен или недоступен',
    ]);
    expect(assessNas(healthy(), hoursAgo(5), NOW).reasons[0]).toContain('5 ч');
  });

  it('allows a report up to half an hour old (three missed ten-minute ones is the limit)', () => {
    expect(assessNas(healthy(), minutesAgo(29), NOW).status).toBe('ok');
    expect(assessNas(healthy(), minutesAgo(31), NOW).status).toBe('bad');
  });

  it('is bad for a degraded RAID and a failed SMART, warn for a RAID that is rebuilding', () => {
    const degraded = assessNas(
      healthy({
        raid: { summary: 'md1 [U_]', degraded: true, syncing: false },
      }),
      minutesAgo(1),
      NOW,
    );
    expect(degraded).toMatchObject({ status: 'bad' });
    expect(degraded.reasons[0]).toContain('md1 [U_]');

    const failed = healthy();
    failed.disks[1].healthPassed = false;
    expect(assessNas(failed, minutesAgo(1), NOW).reasons).toContain(
      'Диск sdb: SMART не пройден',
    );

    expect(
      assessNas(
        healthy({
          raid: { summary: 'md1 [UU]', degraded: false, syncing: true },
        }),
        minutesAgo(1),
        NOW,
      ),
    ).toEqual({
      status: 'warn',
      reasons: ['RAID пересобирается'],
    });
  });

  it('warns about sectors waiting or reallocated, and calls uncorrectable ones bad', () => {
    const sectors = healthy();
    sectors.disks[0].pending = 2;
    sectors.disks[0].reallocated = 8;
    expect(assessNas(sectors, minutesAgo(1), NOW)).toEqual({
      status: 'warn',
      reasons: [
        'Диск sda: секторов в ожидании 2',
        'Диск sda: переназначено секторов 8',
      ],
    });

    sectors.disks[1].uncorrectable = 1;
    expect(assessNas(sectors, minutesAgo(1), NOW)).toMatchObject({
      status: 'bad',
    });
  });

  it('warns about a hot disk, treating a missing reading as nothing to say', () => {
    const hot = healthy();
    hot.disks[0].tempC = 52;
    hot.disks[1].tempC = null;
    expect(assessNas(hot, minutesAgo(1), NOW)).toEqual({
      status: 'warn',
      reasons: ['Диск sda: 52 °C'],
    });
  });

  it('judges the copy by its age: 26 h warns, 50 h is bad, none yet warns', () => {
    const at = (h: number) =>
      healthy({
        backup: {
          createdAt: hoursAgo(h).toISOString(),
          snapshots: 1,
          bytes: 1,
        },
      });

    expect(assessNas(at(26.5), minutesAgo(1), NOW)).toEqual({
      status: 'warn',
      reasons: ['Копия бэкапа устарела: 26 ч'],
    });
    expect(assessNas(at(51), minutesAgo(1), NOW)).toEqual({
      status: 'bad',
      reasons: ['Копия бэкапа старше 51 ч'],
    });
    expect(
      assessNas(
        healthy({ backup: { createdAt: null, snapshots: 0, bytes: 0 } }),
        minutesAgo(1),
        NOW,
      ).reasons,
    ).toEqual(['Копия бэкапа ещё не получена']);
  });

  it('warns when the volume is 85% full', () => {
    expect(
      assessNas(
        healthy({ volume: { totalBytes: 1000, usedBytes: 860 } }),
        minutesAgo(1),
        NOW,
      ).reasons,
    ).toEqual(['Том заполнен на 86 %']);
    expect(
      assessNas(
        healthy({ volume: { totalBytes: 0, usedBytes: 0 } }),
        minutesAgo(1),
        NOW,
      ).status,
    ).toBe('ok');
  });

  it('lists the bad reasons before the warnings', () => {
    const mixed = healthy({
      raid: { summary: 'md1 [U_]', degraded: true, syncing: false },
      volume: { totalBytes: 1000, usedBytes: 900 },
    });

    expect(
      assessNas(mixed, minutesAgo(1), NOW).reasons.map((r) => r.split(' ')[0]),
    ).toEqual(['RAID', 'Том']);
  });
});
