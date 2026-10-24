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
