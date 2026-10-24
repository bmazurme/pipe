import { GithubConnectionService } from './github-connection.service';

const calls: { via: string }[] = [];
let direct: () => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;
let proxied: () => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

jest.mock('undici', () => ({
  Agent: class {
    kind = 'direct';
    async close() {}
  },
  ProxyAgent: class {
    kind = 'proxy';
    constructor(public url: string) {}
    async close() {}
  },
  fetch: jest.fn(
    async (_url: string, init: { dispatcher: { kind: string } }) => {
      calls.push({ via: init.dispatcher.kind });

      return init.dispatcher.kind === 'direct' ? direct() : proxied();
    },
  ),
}));

const ok = async () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new ArrayBuffer(0),
});

describe('GithubConnectionService.check', () => {
  const service = new GithubConnectionService({
    findOne: jest.fn(async () => null),
  } as never);

  beforeEach(() => {
    calls.length = 0;
    direct = ok;
    proxied = ok;
  });

  it('times two cold calls directly and two through the proxy, side by side', async () => {
    const result = await service.check('http://vpn-client:1080');

    expect(result.url).toBe('http://vpn-client:1080');
    expect(result.direct).toHaveLength(2);
    expect(result.proxy).toHaveLength(2);
    expect(
      result.direct.every((sample) => sample.ok && sample.status === 200),
    ).toBe(true);
    expect(calls.filter((call) => call.via === 'direct')).toHaveLength(2);
    expect(calls.filter((call) => call.via === 'proxy')).toHaveLength(2);
  });

  it('reports a call that failed with its reason instead of throwing', async () => {
    direct = async () => {
      throw new Error('The operation was aborted due to timeout');
    };

    const result = await service.check('http://vpn-client:1080');

    expect(result.direct[0]).toMatchObject({
      ok: false,
      status: null,
      error: 'The operation was aborted due to timeout',
    });
    expect(result.proxy?.[0]).toMatchObject({ ok: true });
  });

  it('uses the default proxy address when none is given, and refuses a malformed one', async () => {
    expect((await service.check()).url).toBe('http://vpn-client:1080');
    await expect(service.check('socks5://x:1')).rejects.toThrow();
  });
});
