import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { BackupStatusService } from './backup-status.service';
import { DashboardController } from './dashboard.controller';
import { NodesService } from './nodes.service';

describe('DashboardController access', () => {
  it('is guarded by JwtGuard and OwnerGuard — browser session, owner-only', () => {
    const guards = Reflect.getMetadata('__guards__', DashboardController);

    expect(guards).toEqual([JwtGuard, OwnerGuard]);
  });
});

describe('DashboardController routes', () => {
  it('delegates to NodesService and BackupStatusService', async () => {
    const nodes = { getStatus: jest.fn().mockResolvedValue({ nodes: [] }) };
    const backups = {
      getStatus: jest.fn().mockResolvedValue({
        configured: false,
        lastBackupAt: null,
        rawBytes: null,
      }),
    };
    const controller = new DashboardController(
      nodes as unknown as NodesService,
      backups as unknown as BackupStatusService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.getNodes()).resolves.toEqual({ nodes: [] });
    expect(nodes.getStatus).toHaveBeenCalled();

    await expect(controller.getBackups()).resolves.toEqual({
      configured: false,
      lastBackupAt: null,
      rawBytes: null,
    });
    expect(backups.getStatus).toHaveBeenCalled();
  });
});

describe('DashboardController: the connection to GitHub', () => {
  const github = {
    state: jest
      .fn()
      .mockResolvedValue({ enabled: false, url: 'u', source: 'default' }),
    save: jest.fn().mockResolvedValue({
      enabled: true,
      url: 'http://p:1',
      source: 'setting',
    }),
    check: jest
      .fn()
      .mockResolvedValue({ direct: [], proxy: [], url: 'http://p:1' }),
  };
  const controller = new DashboardController(
    {} as never,
    {} as never,
    github as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('reads, saves and checks through the service', async () => {
    await expect(controller.getGithubConnection()).resolves.toMatchObject({
      source: 'default',
    });
    await expect(
      controller.saveGithubConnection({ enabled: true, url: 'http://p:1' }),
    ).resolves.toMatchObject({ enabled: true });
    expect(github.save).toHaveBeenCalledWith(true, 'http://p:1');
    await controller.checkGithubConnection({ url: 'http://p:1' });
    expect(github.check).toHaveBeenCalledWith('http://p:1');
  });
});

describe('DashboardController deploys', () => {
  it('returns what the service lists', async () => {
    const latest = jest.fn().mockResolvedValue([{ sha: 'a'.repeat(40) }]);
    const controller = new DashboardController(
      {} as never,
      {} as never,
      {} as never,
      { latest } as never,
      {} as never,
      {} as never,
    );

    await expect(controller.getDeploys()).resolves.toEqual([
      { sha: 'a'.repeat(40) },
    ]);
  });
});

describe('DashboardController nas', () => {
  it("lists the signed-in owner's NAS reports", async () => {
    const list = jest.fn().mockResolvedValue([{ host: 'MyCloudEX2Ultra' }]);
    const controller = new DashboardController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { list } as never,
      {} as never,
    );

    await expect(controller.getNas({ id: 7 })).resolves.toEqual([
      { host: 'MyCloudEX2Ultra' },
    ]);
    expect(list).toHaveBeenCalledWith(7);
  });
});

describe('DashboardController board metrics', () => {
  const make = (summary: jest.Mock) =>
    new DashboardController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { summary } as never,
    );

  it("passes the owner and the window to the service, 24 hours by default via the pipe's value", async () => {
    const summary = jest.fn().mockResolvedValue([{ host: 'ubuntu-red' }]);

    await expect(make(summary).getBoardMetrics({ id: 7 }, 24)).resolves.toEqual(
      [{ host: 'ubuntu-red' }],
    );
    expect(summary).toHaveBeenCalledWith(7, 24);
  });

  it('refuses a window of nothing or longer than the 7 days that are kept', () => {
    const controller = make(jest.fn());

    expect(() => controller.getBoardMetrics({ id: 7 }, 0)).toThrow(
      /between 1 and 168/,
    );
    expect(() => controller.getBoardMetrics({ id: 7 }, 169)).toThrow(
      /between 1 and 168/,
    );
  });
});
