import { AppController } from './app.controller';

const res = () => ({ status: jest.fn() }) as never;

describe('AppController health', () => {
  it('adds the state of the external heartbeat, never its address, when there is one', async () => {
    const app = {
      getHealthStatus: jest.fn().mockResolvedValue({
        status: 'ok',
        database: true,
        pendingMigrations: false,
      }),
    };
    const heartbeat = {
      status: jest.fn().mockReturnValue({
        configured: true,
        lastOkAt: 't',
        lastFailureAt: null,
        lastFailure: null,
        lastSkippedAt: null,
      }),
    };
    const controller = new AppController(app as never, heartbeat as never);

    await expect(controller.getHealthStatus(res())).resolves.toEqual({
      status: 'ok',
      database: true,
      pendingMigrations: false,
      externalHeartbeat: {
        configured: true,
        lastOkAt: 't',
        lastFailureAt: null,
        lastFailure: null,
        lastSkippedAt: null,
      },
    });
  });

  it('is the plain readiness without it (and the answer stays 503 when degraded)', async () => {
    const app = {
      getHealthStatus: jest.fn().mockResolvedValue({
        status: 'degraded',
        database: false,
        pendingMigrations: true,
      }),
    };
    const response = { status: jest.fn() };
    const controller = new AppController(app as never);

    await expect(
      controller.getHealthStatus(response as never),
    ).resolves.toEqual({
      status: 'degraded',
      database: false,
      pendingMigrations: true,
    });
    expect(response.status).toHaveBeenCalledWith(503);
  });
});
