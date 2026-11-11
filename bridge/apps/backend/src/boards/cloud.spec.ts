import { assessCloud, CLOUD_STALE_AFTER_MS, CloudData } from './cloud';

const NOW = new Date('2026-11-11T12:00:00Z');
const fresh = new Date(NOW.getTime() - 30_000);
const GB = 1024 ** 3;

const healthy = (): CloudData => ({
  host: 'yc-vm',
  uptimeSec: 5 * 86_400,
  cpus: 2,
  load5: 0.3,
  memory: {
    totalMb: 4096,
    availableMb: 2000,
    swapTotalMb: 2048,
    swapUsedMb: 10,
  },
  disk: { totalBytes: 29 * GB, usedBytes: 12 * GB },
  services: [
    {
      name: 'bridge_backend',
      desired: 1,
      running: 1,
      health: 'healthy',
      restarts24h: 0,
      memMb: 120,
      critical: true,
    },
    {
      name: 'notes_client',
      desired: 1,
      running: 1,
      health: 'none',
      critical: false,
    },
  ],
  probes: [
    {
      name: 'https://api.bridge.ntlstl.dev/api/v1/health',
      ok: true,
      httpCode: 200,
      ms: 40,
      critical: true,
    },
  ],
});

describe('assessCloud', () => {
  it('says ok for a healthy VM', () => {
    expect(assessCloud(healthy(), fresh, NOW)).toEqual({
      status: 'ok',
      reasons: [],
    });
  });

  it('treats a missing report as a problem and ignores the rest of it', () => {
    const old = new Date(NOW.getTime() - CLOUD_STALE_AFTER_MS - 60_000);
    const data = { ...healthy(), exposedPorts: [5432] };

    const result = assessCloud(data, old, NOW);

    expect(result.status).toBe('bad');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/не присылает отчёт 6 мин/);
  });

  it('counts hours once the silence is long', () => {
    const old = new Date(NOW.getTime() - 3 * 3_600_000);

    expect(assessCloud(healthy(), old, NOW).reasons[0]).toMatch(/3 ч/);
  });

  it('remarks on a VM that has just rebooted', () => {
    const result = assessCloud({ ...healthy(), uptimeSec: 240 }, fresh, NOW);

    expect(result.status).toBe('warn');
    expect(result.reasons).toEqual(['VM перезагружалась 4 мин назад']);
  });

  describe('memory and swap', () => {
    it('is a problem under 250 MB or 15 %', () => {
      const small = {
        ...healthy(),
        memory: {
          totalMb: 1963,
          availableMb: 92,
          swapTotalMb: 2048,
          swapUsedMb: 0,
        },
      };
      const pct = {
        ...healthy(),
        memory: {
          totalMb: 8192,
          availableMb: 1000,
          swapTotalMb: 2048,
          swapUsedMb: 0,
        },
      };

      expect(assessCloud(small, fresh, NOW).reasons[0]).toMatch(
        /Память на исходе: доступно 92 МБ \(5 %\)/,
      );
      expect(assessCloud(pct, fresh, NOW).status).toBe('bad');
    });

    it('is a remark under 25 %', () => {
      const data = {
        ...healthy(),
        memory: {
          totalMb: 4000,
          availableMb: 800,
          swapTotalMb: 2048,
          swapUsedMb: 0,
        },
      };

      expect(assessCloud(data, fresh, NOW)).toEqual({
        status: 'warn',
        reasons: ['Мало памяти: доступно 800 МБ (20 %)'],
      });
    });

    it('warns that there is no swap, and when swap is more than half used', () => {
      const none = {
        ...healthy(),
        memory: { ...healthy().memory, swapTotalMb: 0, swapUsedMb: 0 },
      };
      const used = {
        ...healthy(),
        memory: { ...healthy().memory, swapTotalMb: 2000, swapUsedMb: 1200 },
      };

      expect(assessCloud(none, fresh, NOW).reasons[0]).toMatch(
        /Swap не настроен/,
      );
      expect(assessCloud(used, fresh, NOW).reasons).toEqual([
        'Swap занят на 60 %',
      ]);
    });
  });

  it('judges the disk: remark from 80 %, problem from 90 %', () => {
    const at = (used: number) => ({
      ...healthy(),
      disk: { totalBytes: 100 * GB, usedBytes: used * GB },
    });

    expect(assessCloud(at(79), fresh, NOW).status).toBe('ok');
    expect(assessCloud(at(80), fresh, NOW)).toEqual({
      status: 'warn',
      reasons: ['Диск заполнен на 80 %'],
    });
    expect(assessCloud(at(90), fresh, NOW)).toEqual({
      status: 'bad',
      reasons: ['Диск заполнен на 90 %'],
    });
  });

  it('judges the load per core', () => {
    expect(assessCloud({ ...healthy(), load5: 3.2 }, fresh, NOW).status).toBe(
      'warn',
    );
    expect(assessCloud({ ...healthy(), load5: 6.5 }, fresh, NOW).status).toBe(
      'bad',
    );
    expect(assessCloud({ ...healthy(), load5: null }, fresh, NOW).status).toBe(
      'ok',
    );
  });

  describe('services', () => {
    it('is a problem when a critical one is not fully up, only a remark for a non-critical one', () => {
      const data = healthy();
      data.services = [
        { name: 'bridge_backend', desired: 1, running: 0, critical: true },
        { name: 'notes_client', desired: 1, running: 0, critical: false },
      ];

      const result = assessCloud(data, fresh, NOW);

      expect(result.status).toBe('bad');
      expect(result.reasons).toEqual([
        'Сервис bridge_backend: запущено 0 из 1',
        'Сервис notes_client: запущено 0 из 1',
      ]);
    });

    it('ignores a service scaled to zero on purpose', () => {
      const data = healthy();
      data.services = [
        { name: 'bridge_backend', desired: 0, running: 0, critical: true },
      ];

      expect(assessCloud(data, fresh, NOW).status).toBe('ok');
    });

    it('notices an unhealthy container and frequent restarts', () => {
      const data = healthy();
      data.services = [
        {
          name: 'bridge_backend',
          desired: 1,
          running: 1,
          health: 'unhealthy',
          restarts24h: 4,
          critical: true,
        },
      ];

      expect(assessCloud(data, fresh, NOW).reasons).toEqual([
        'Сервис bridge_backend: health check не проходит',
        'Сервис bridge_backend: 4 перезапусков за сутки',
      ]);
    });
  });

  it('reports a failed probe with its code, by criticality', () => {
    const data = healthy();
    data.probes = [
      {
        name: 'https://api.bridge.ntlstl.dev/api/v1/health',
        ok: false,
        httpCode: 502,
        critical: true,
      },
      { name: 'https://notes.ntlstl.dev', ok: false, critical: false },
    ];

    expect(assessCloud(data, fresh, NOW)).toEqual({
      status: 'bad',
      reasons: [
        'Не отвечает https://api.bridge.ntlstl.dev/api/v1/health (код 502)',
        'Не отвечает https://notes.ntlstl.dev',
      ],
    });
  });

  describe('replication', () => {
    const withReplica = (replication: CloudData['replication']) => ({
      ...healthy(),
      replication,
    });

    it('is silent when no replica is expected', () => {
      expect(assessCloud(healthy(), fresh, NOW).status).toBe('ok');
      expect(assessCloud(withReplica(null), fresh, NOW).status).toBe('ok');
    });

    it('is a problem when the replica is not connected', () => {
      expect(
        assessCloud(withReplica({ connected: false, lagSec: null }), fresh, NOW)
          .reasons[0],
      ).toMatch(/не подключена/);
    });

    it('is a remark from a minute of lag and a problem from ten', () => {
      expect(
        assessCloud(withReplica({ connected: true, lagSec: 5 }), fresh, NOW)
          .status,
      ).toBe('ok');
      expect(
        assessCloud(withReplica({ connected: true, lagSec: 90 }), fresh, NOW),
      ).toEqual({
        status: 'warn',
        reasons: ['Реплика отстаёт на 90 с'],
      });
      expect(
        assessCloud(withReplica({ connected: true, lagSec: 720 }), fresh, NOW)
          .reasons[0],
      ).toMatch(/отстаёт на 12 мин/);
    });
  });

  it('judges backups per set by age', () => {
    const data = {
      ...healthy(),
      backups: [
        { name: 'bridge', ageHours: 3 },
        { name: 'notes', ageHours: 30.4 },
        { name: 'places', ageHours: 60 },
        { name: 'config', ageHours: null },
      ],
    };

    expect(assessCloud(data, fresh, NOW).reasons).toEqual([
      'Бэкап places старше 60 ч',
      'Бэкап notes устарел: 30 ч',
      'Бэкап config: копии ещё нет',
    ]);
  });

  it('warns about certificates close to their end', () => {
    const data = {
      ...healthy(),
      certs: [
        { name: 'api.bridge.ntlstl.dev', days: 10 },
        { name: 'ntlstl.dev', days: 3 },
        { name: 'notes', days: 60 },
      ],
    };

    expect(assessCloud(data, fresh, NOW).reasons).toEqual([
      'Сертификат ntlstl.dev: осталось 3 дн.',
      'Сертификат api.bridge.ntlstl.dev: осталось 10 дн.',
    ]);
  });

  it('makes a port open to the internet a problem', () => {
    const result = assessCloud(
      { ...healthy(), exposedPorts: [5432, 3300] },
      fresh,
      NOW,
    );

    expect(result.status).toBe('bad');
    expect(result.reasons[0]).toMatch(/Порт 5432, 3300 открыт в интернет/);
  });

  it('lists problems before remarks', () => {
    const data = { ...healthy(), uptimeSec: 60, exposedPorts: [5432] };

    const { reasons } = assessCloud(data, fresh, NOW);

    expect(reasons[0]).toMatch(/Порт 5432/);
    expect(reasons[1]).toMatch(/перезагружалась/);
  });
});
