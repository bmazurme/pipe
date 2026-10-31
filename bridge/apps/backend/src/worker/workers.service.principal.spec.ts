import { hashSecret } from '../auth/worker-keys.service';

import { WorkersService } from './workers.service';

function build() {
  const workersRepo = { findOne: jest.fn() };
  const useLookup = jest.fn();
  const service = new WorkersService(
    workersRepo as never,
    {} as never,
    {} as never,
    {} as never,
    { useLookup } as never,
    {} as never,
    {} as never,
  );

  return { service, workersRepo, useLookup };
}

describe('WorkersService.findPrincipalByKeyHash', () => {
  it('selects only id and userId by the key hash', async () => {
    const { service, workersRepo } = build();
    workersRepo.findOne.mockResolvedValue({ id: 3, userId: 9 });

    await expect(
      service.findPrincipalByKeyHash(hashSecret('brw_x')),
    ).resolves.toEqual({ id: 3, userId: 9 });
    expect(workersRepo.findOne).toHaveBeenCalledWith({
      where: { keyHash: hashSecret('brw_x') },
      select: { id: true, userId: true },
    });
  });

  it('is null when no worker holds the hash', async () => {
    const { service, workersRepo } = build();
    workersRepo.findOne.mockResolvedValue(null);

    await expect(service.findPrincipalByKeyHash('nope')).resolves.toBeNull();
  });

  it('registers itself as the worker-key lookup on init', async () => {
    const { service, workersRepo, useLookup } = build();
    workersRepo.findOne.mockResolvedValue({ id: 1, userId: 2 });

    service.onModuleInit();
    const registered = useLookup.mock.calls[0][0];

    await expect(registered('h')).resolves.toEqual({ id: 1, userId: 2 });
  });
});
