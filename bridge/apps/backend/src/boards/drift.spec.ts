import {
  assessDrift,
  compareVersions,
  type DriftBoard,
  driftDigest,
  type DriftWorker,
} from './drift';

const NOW = new Date('2026-11-27T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const board = (over: Partial<DriftBoard> = {}): DriftBoard => ({
  host: 'ubuntu-red',
  reportedAt: minutesAgo(5),
  online: true,
  outdatedScripts: 0,
  workers: [],
  workerLast: null,
  lastUpdate: null,
  ...over,
});

const container = (over = {}) => ({
  name: 'pipe-worker-pi-red',
  image: 'ghcr.io/bmazurme/pipe-worker:stable',
  running: true,
  restartCount: 0,
  startedAt: minutesAgo(600).toISOString(),
  oomKilled: false,
  ...over,
});

describe('compareVersions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });

  it('does not compare what is not a version', () => {
    expect(compareVersions('dev', '1.0.0')).toBeNull();
  });
});

describe('assessDrift', () => {
  it('is ok when nothing drifted', () => {
    const view = assessDrift([board({ workers: [container()] })], [], NOW);

    expect(view).toEqual({ status: 'ok', items: [] });
  });

  it('flags a board that stopped reporting', () => {
    const view = assessDrift(
      [board({ online: false, reportedAt: minutesAgo(5 * 60) })],
      [],
      NOW,
    );

    expect(view.status).toBe('bad');
    expect(view.items[0].text).toContain('5 ч');
  });

  it('flags a stopped worker container as bad', () => {
    const view = assessDrift(
      [board({ workers: [container({ running: false })] })],
      [],
      NOW,
    );

    expect(view.status).toBe('bad');
    expect(view.items[0].text).toContain('не запущен');
  });

  it('warns about a few restarts, and calls many of them bad', () => {
    const few = assessDrift(
      [board({ workers: [container({ restartCount: 3 })] })],
      [],
      NOW,
    );
    const many = assessDrift(
      [board({ workers: [container({ restartCount: 12 })] })],
      [],
      NOW,
    );

    expect(few.status).toBe('warn');
    expect(many.status).toBe('bad');
  });

  it('calls a young container that has restarted a loop happening now', () => {
    const view = assessDrift(
      [
        board({
          workers: [
            container({
              restartCount: 3,
              startedAt: minutesAgo(2).toISOString(),
            }),
          ],
        }),
      ],
      [],
      NOW,
    );

    expect(view.status).toBe('bad');
    expect(view.items[0].text).toContain('происходит сейчас');
  });

  it('is not alarmed by an agent that does not report restarts', () => {
    const { restartCount, startedAt, oomKilled, ...old } = container();

    void restartCount;
    void startedAt;
    void oomKilled;
    expect(assessDrift([board({ workers: [old] })], [], NOW).status).toBe('ok');
  });

  it('warns about a container killed for memory and about an image that is not stable', () => {
    const view = assessDrift(
      [
        board({
          workers: [
            container({
              oomKilled: true,
              image: 'ghcr.io/bmazurme/pipe-worker:0.1.0',
            }),
          ],
        }),
      ],
      [],
      NOW,
    );

    expect(view.items.map((i) => i.id)).toEqual([
      'ubuntu-red:worker-image:pipe-worker-pi-red',
      'ubuntu-red:worker-oom:pipe-worker-pi-red',
    ]);
  });

  it('says a failed update for a day, then lets it go', () => {
    const failed = (finishedAt: Date) =>
      board({
        workerLast: { status: 'failed', result: 'could not pull', finishedAt },
      });

    expect(
      assessDrift([failed(minutesAgo(60))], [], NOW).items[0].text,
    ).toContain('could not pull');
    expect(assessDrift([failed(minutesAgo(25 * 60))], [], NOW).items).toEqual(
      [],
    );
    expect(
      assessDrift(
        [
          board({
            workerLast: {
              status: 'applied',
              result: null,
              finishedAt: minutesAgo(1),
            },
          }),
        ],
        [],
        NOW,
      ).items,
    ).toEqual([]);
  });

  it('flags a board whose workers run without the home-network filter, and only when the agent says so', () => {
    const run = [container()];

    expect(
      assessDrift([board({ workers: run, workerEgress: false })], [], NOW)
        .items[0].text,
    ).toContain('фильтр домашней сети');
    expect(
      assessDrift([board({ workers: run, workerEgress: true })], [], NOW).items,
    ).toEqual([]);
    // An agent older than version 5 says nothing: not a finding.
    expect(assessDrift([board({ workers: run })], [], NOW).items).toEqual([]);
    // No worker on the board: nothing to filter.
    expect(
      assessDrift([board({ workerEgress: false })], [], NOW).items,
    ).toEqual([]);
  });

  it('flags scripts behind main', () => {
    const view = assessDrift([board({ outdatedScripts: 2 })], [], NOW);

    expect(view.items[0].text).toContain('(2)');
  });

  it('flags a live worker on an older version than the fleet, but not a switched-off one', () => {
    const workers: DriftWorker[] = [
      { name: 'pi-red', version: '0.2.0', online: true, enabled: true },
      { name: 'pi-blue', version: '0.1.0', online: true, enabled: true },
      { name: 'pi-green', version: '0.1.0', online: false, enabled: true },
      { name: 'old-one', version: '0.0.1', online: true, enabled: false },
    ];
    const view = assessDrift([], workers, NOW);

    expect(view.items.map((i) => i.subject)).toEqual(['pi-blue']);
    expect(view.items[0].text).toContain('0.2.0');
  });

  it('puts the bad ones first', () => {
    const view = assessDrift(
      [board({ outdatedScripts: 1, workers: [container({ running: false })] })],
      [],
      NOW,
    );

    expect(view.items.map((i) => i.level)).toEqual(['bad', 'warn']);
  });
});

describe('driftDigest', () => {
  it('is silent when there is nothing to say', () => {
    expect(driftDigest({ status: 'ok', items: [] })).toBeNull();
  });

  it('lists the items, shortening the host and capping the length', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      id: `h:${i}`,
      level: 'warn' as const,
      subject: 'ubuntu-red',
      text: `item ${i}`,
    }));
    const text = driftDigest({ status: 'warn', items }) as string;

    expect(text).toContain('Дрейф и тихие отказы — 15');
    expect(text).toContain('🟡 red: item 0');
    expect(text).toContain('… и ещё 3');
    expect(text).not.toContain('item 14');
  });
});
