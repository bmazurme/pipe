import { DeploysService } from './deploys.service';

describe('DeploysService.latest', () => {
  it('lists the newest reports first, as plain views', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        id: 7,
        sha: 'a'.repeat(40),
        previousSha: 'b'.repeat(8),
        result: 'rolled_back',
        detail: 'не поднялась',
        prNumbers: [41, 42],
        createdAt: new Date('2026-10-30T10:31:07Z'),
      },
    ]);
    const service = new DeploysService({ find } as never);

    expect(await service.latest()).toEqual([
      {
        sha: 'a'.repeat(40),
        previousSha: 'b'.repeat(8),
        result: 'rolled_back',
        detail: 'не поднялась',
        prNumbers: [41, 42],
        at: '2026-10-30T10:31:07.000Z',
      },
    ]);
    expect(find).toHaveBeenCalledWith({ order: { id: 'DESC' }, take: 10 });
  });

  it('is empty before any release was reported', async () => {
    const service = new DeploysService({
      find: jest.fn().mockResolvedValue([]),
    } as never);

    expect(await service.latest()).toEqual([]);
  });
});
