import {
  assessDrills,
  type DrillData,
  drillAlert,
  type DrillRow,
  parseBackupDate,
} from './restore-drill';

const NOW = new Date('2026-12-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const ok = (daysBack: number, extra: Partial<DrillData> = {}): DrillRow => ({
  ranAt: daysAgo(daysBack),
  data: {
    host: 'mac',
    ok: true,
    backupCreatedAt: new Date(daysAgo(daysBack).getTime() - 9 * 3_600_000)
      .toISOString()
      .replace(/[-:]|\.\d+/g, ''),
    restoreSeconds: 95,
    tables: 40,
    rows: 10_000,
    counts: { users: 3, jobs: 500 },
    ...extra,
  },
});

const failed = (daysBack: number, error = 'pg_restore: exit 1'): DrillRow => ({
  ranAt: daysAgo(daysBack),
  data: { host: 'mac', ok: false, error },
});

describe('parseBackupDate', () => {
  it('reads the bare UTC stamp backup.sh writes', () => {
    expect(parseBackupDate('20261110T030000Z')?.toISOString()).toBe(
      '2026-11-10T03:00:00.000Z',
    );
  });

  it('reads an ISO date and rejects nonsense', () => {
    expect(parseBackupDate('2026-11-10T03:00:00Z')?.toISOString()).toBe(
      '2026-11-10T03:00:00.000Z',
    );
    expect(parseBackupDate('yesterday')).toBeNull();
    expect(parseBackupDate(null)).toBeNull();
  });
});

describe('assessDrills', () => {
  it('says so when a drill never ran, without calling it an emergency', () => {
    const result = assessDrills([], NOW);

    expect(result.status).toBe('warn');
    expect(result.reasons[0]).toMatch(/ни разу/);
    expect(result.lastOkAt).toBeNull();
  });

  it('is fine after a recent good drill, and reports the measured RPO and restore time', () => {
    const result = assessDrills([ok(3)], NOW);

    expect(result).toMatchObject({
      status: 'ok',
      reasons: [],
      backupAgeHours: 9,
      restoreSeconds: 95,
    });
    expect(result.nextDueAt).toBe(daysAgo(3 - 30).toISOString());
  });

  it('asks for a repeat after 30 days, and raises the alarm after 35', () => {
    expect(assessDrills([ok(31)], NOW)).toMatchObject({ status: 'warn' });
    expect(assessDrills([ok(35)], NOW).status).toBe('warn');

    const late = assessDrills([ok(36)], NOW);

    expect(late.status).toBe('bad');
    expect(late.reasons[0]).toMatch(/36 дн/);
  });

  it('a failed newest drill is bad even though an older one passed', () => {
    const result = assessDrills([failed(1, 'checksum mismatch'), ok(20)], NOW);

    expect(result.status).toBe('bad');
    expect(result.reasons[0]).toMatch(/провалилось: checksum mismatch/);
    expect(result.lastOkAt).toBe(daysAgo(20).toISOString());
  });

  it('is bad when no drill ever passed', () => {
    const result = assessDrills([failed(2), failed(9)], NOW);

    expect(result.status).toBe('bad');
    expect(result.reasons.join('|')).toMatch(/Ни одно учение/);
  });

  it('warns when the restored backup was already stale or the restore got slow', () => {
    const stale = assessDrills(
      [ok(2, { backupCreatedAt: daysAgo(5).toISOString() })],
      NOW,
    );
    const slow = assessDrills([ok(2, { restoreSeconds: 2400 })], NOW);

    expect(stale.status).toBe('warn');
    expect(stale.reasons[0]).toMatch(/возрастом \d+ ч/);
    expect(slow.reasons[0]).toMatch(/40 мин/);
  });

  it('is bad when a table that had rows last time came back empty', () => {
    const result = assessDrills(
      [ok(1, { counts: { users: 3, jobs: 0 } }), ok(30)],
      NOW,
    );

    expect(result.status).toBe('bad');
    expect(result.reasons[0]).toMatch(/jobs.*500.*пусто/);
  });

  it('warns when the rows fell by more than half between two good drills', () => {
    const result = assessDrills([ok(1, { rows: 3000 }), ok(30)], NOW);

    expect(result.status).toBe('warn');
    expect(result.reasons[0]).toMatch(/3000.*10000/);
  });

  it('compares with the previous GOOD drill, skipping failed ones in between', () => {
    const result = assessDrills(
      [ok(1, { rows: 3000 }), failed(15), ok(30)],
      NOW,
    );

    expect(result.reasons[0]).toMatch(/10000/);
  });
});

describe('drillAlert', () => {
  it('speaks only for a bad verdict', () => {
    expect(drillAlert(assessDrills([ok(3)], NOW))).toBeNull();
    expect(drillAlert(assessDrills([ok(32)], NOW))).toBeNull();
    expect(drillAlert(assessDrills([], NOW))).toBeNull();
  });

  it('names the first reason and counts the rest', () => {
    const text = drillAlert(assessDrills([failed(1, 'boom'), ok(40)], NOW));

    expect(text).toMatch(/провалилось: boom/);
    expect(text).toMatch(/и ещё 1/);
  });
});
