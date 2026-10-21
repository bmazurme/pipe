import { SharedAsyncCache } from './shared-async-cache';

describe('SharedAsyncCache', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds once for repeated gets of one key', async () => {
    const cache = new SharedAsyncCache<string>({ maxEntries: 1 });
    const build = jest.fn(() => Promise.resolve('value'));

    expect(await cache.get('a', build)).toBe('value');
    expect(await cache.get('a', build)).toBe('value');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('shares one build between concurrent gets', async () => {
    const cache = new SharedAsyncCache<string>({ maxEntries: 1 });
    let resolve!: (value: string) => void;
    const build = jest.fn(
      () => new Promise<string>((done) => (resolve = done)),
    );

    const first = cache.get('a', build);
    const second = cache.get('a', build);

    await Promise.resolve();
    resolve('value');

    expect(await first).toBe('value');
    expect(await second).toBe('value');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds again once the value is older than the TTL', async () => {
    const cache = new SharedAsyncCache<string>({
      ttlMs: 1000,
      maxEntries: 1,
    });
    const build = jest.fn(() => Promise.resolve('value'));
    const now = jest.spyOn(Date, 'now');
    const t0 = 1_000_000;

    now.mockReturnValue(t0);
    await cache.get('a', build);
    now.mockReturnValue(t0 + 999);
    await cache.get('a', build);
    expect(build).toHaveBeenCalledTimes(1);

    now.mockReturnValue(t0 + 1001);
    await cache.get('a', build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('builds again for a new key', async () => {
    const cache = new SharedAsyncCache<string>({ maxEntries: 2 });
    const build = jest.fn((key: string) => Promise.resolve(key));

    expect(await cache.get('a', () => build('a'))).toBe('a');
    expect(await cache.get('b', () => build('b'))).toBe('b');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest value past maxEntries', async () => {
    const cache = new SharedAsyncCache<string>({ maxEntries: 2 });
    const build = jest.fn((key: string) => Promise.resolve(key));
    const get = (key: string) => cache.get(key, () => build(key));

    await get('a');
    await get('b');
    await get('c');
    expect(build).toHaveBeenCalledTimes(3);

    await get('b');
    await get('c');
    expect(build).toHaveBeenCalledTimes(3);

    await get('a');
    expect(build).toHaveBeenCalledTimes(4);
  });

  it('does not cache a rejected build', async () => {
    const cache = new SharedAsyncCache<string>({ maxEntries: 1 });
    const build = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('value');

    await expect(cache.get('a', build)).rejects.toThrow('boom');
    expect(await cache.get('a', build)).toBe('value');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('turns a build that throws synchronously into a rejection', async () => {
    const cache = new SharedAsyncCache<string>({ maxEntries: 1 });
    const build = jest
      .fn<Promise<string>, []>()
      .mockImplementationOnce(() => {
        throw new Error('sync');
      })
      .mockResolvedValueOnce('value');

    await expect(cache.get('a', build)).rejects.toThrow('sync');
    expect(await cache.get('a', build)).toBe('value');
  });
});
