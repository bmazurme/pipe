import { WorkerConfigResponseDto } from './dto/worker-fleet.dto';
import { WorkersController } from './workers.controller';

// GET me/config is the one place a decrypted Claude token goes to a worker outside a claimed job: only while a limit
// probe is due, and resolved for that very worker.
describe('WorkersController config limitProbe', () => {
  const baseConfig = (
    overrides: Partial<WorkerConfigResponseDto> = {},
  ): WorkerConfigResponseDto => ({
    id: 7,
    name: 'w',
    enabled: true,
    models: null,
    pollIntervalSec: 10,
    jobTimeoutSec: 3600,
    proxyUrl: null,
    chatEnabled: false,
    vpnLink: null,
    limitsRefreshMin: 0,
    limitsRefreshRequestedAt: null,
    limitProbe: null,
    capabilities: [],
    ...overrides,
  });

  const setup = (
    config: WorkerConfigResponseDto,
    claudeToken: string | null = 'sk-probe',
  ) => {
    const workersService = {
      configForPrincipal: jest.fn().mockResolvedValue(config),
    };
    const runCredentials = {
      resolve: jest.fn().mockResolvedValue({ claudeToken }),
    };
    const controller = new WorkersController(
      workersService as never,
      runCredentials as never,
    );

    return { controller, workersService, runCredentials };
  };

  const currentUser = { id: 5, workerId: 7 };

  it('does not resolve or attach a token while no probe is due', async () => {
    const { controller, runCredentials } = setup(baseConfig());

    const result = await controller.config(currentUser);

    expect(runCredentials.resolve).not.toHaveBeenCalled();
    expect(result.limitProbe).toBeNull();
  });

  it("attaches this worker's sonnet token while a probe is due", async () => {
    const { controller, runCredentials } = setup(
      baseConfig({ limitsRefreshMin: 30 }),
    );

    const result = await controller.config(currentUser);

    expect(runCredentials.resolve).toHaveBeenCalledTimes(1);
    expect(runCredentials.resolve).toHaveBeenCalledWith(5, 7, 'sonnet');
    expect(result.limitProbe).toEqual({ claudeToken: 'sk-probe' });
  });

  it('sets limitProbe to null when a probe is due but there is no token', async () => {
    const { controller, runCredentials } = setup(
      baseConfig({ limitsRefreshRequestedAt: new Date() }),
      null,
    );

    const result = await controller.config(currentUser);

    expect(runCredentials.resolve).toHaveBeenCalledWith(5, 7, 'sonnet');
    expect(result.limitProbe).toBeNull();
  });

  it('passes x-worker-version through to configForPrincipal', async () => {
    const { controller, workersService } = setup(baseConfig());

    await controller.config(currentUser, '1.2.3');

    expect(workersService.configForPrincipal).toHaveBeenCalledWith(
      currentUser,
      '1.2.3',
    );
  });
});
