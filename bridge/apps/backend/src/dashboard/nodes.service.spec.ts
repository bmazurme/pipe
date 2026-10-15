import { NodesService } from './nodes.service';

function setup(env: Record<string, string> = {}) {
  const config = { get: jest.fn((key: string) => env[key]) };

  return { service: new NodesService(config as never) };
}

function mockFetchOnce(status: number, body: unknown) {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const dockerNode = (
  hostname: string,
  state = 'ready',
  availability = 'active',
) => ({
  Description: { Hostname: hostname },
  Status: { State: state },
  Spec: { Availability: availability },
});

describe('NodesService.getStatus', () => {
  it('reports every known board as ready when the proxy lists all 4', async () => {
    mockFetchOnce(200, [
      dockerNode('ubuntu-white'),
      dockerNode('ubuntu-red'),
      dockerNode('ubuntu-green'),
      dockerNode('ubuntu-blue'),
    ]);

    const { service } = setup();
    const status = await service.getStatus();

    expect(status.nodes).toHaveLength(4);
    expect(status.nodes.every((node) => node.state === 'ready')).toBe(true);
    expect(status.nodes.find((n) => n.hostname === 'ubuntu-white')?.label).toBe(
      'white',
    );
  });

  it('marks a board missing from the live list as unknown instead of dropping it', async () => {
    mockFetchOnce(200, [
      dockerNode('ubuntu-white'),
      dockerNode('ubuntu-red'),
      dockerNode('ubuntu-green'),
    ]);

    const { service } = setup();
    const status = await service.getStatus();

    expect(status.nodes).toHaveLength(4);
    expect(
      status.nodes.find((n) => n.hostname === 'ubuntu-blue'),
    ).toMatchObject({
      state: 'unknown',
    });
  });

  it('reports a down board as down, not ready', async () => {
    mockFetchOnce(200, [
      dockerNode('ubuntu-white'),
      dockerNode('ubuntu-red', 'disconnected'),
      dockerNode('ubuntu-green'),
      dockerNode('ubuntu-blue'),
    ]);

    const { service } = setup();
    const status = await service.getStatus();

    expect(status.nodes.find((n) => n.hostname === 'ubuntu-red')).toMatchObject(
      {
        state: 'down',
      },
    );
  });

  it('turns a proxy failure into every board unknown, with an error message, not a throw', async () => {
    (global.fetch as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED'));

    const { service } = setup();
    const status = await service.getStatus();

    expect(status.error).toContain('ECONNREFUSED');
    expect(status.nodes).toHaveLength(4);
    expect(status.nodes.every((node) => node.state === 'unknown')).toBe(true);
  });

  it('treats a non-2xx proxy response as a failure too', async () => {
    mockFetchOnce(502, {});

    const { service } = setup();
    const status = await service.getStatus();

    expect(status.error).toContain('502');
  });
});
