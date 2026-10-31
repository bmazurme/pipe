import { UnauthorizedException } from '@nestjs/common';

import { WorkersService } from './workers.service';

function build(results: { affected: number; raw: unknown[] }[]) {
  const set = jest.fn().mockReturnThis();
  const qb = {
    update: jest.fn().mockReturnThis(),
    set,
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };
  for (const r of results) qb.execute.mockResolvedValueOnce(r);
  const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
  const service = new WorkersService(
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, qb, set };
}

describe('WorkersService.enroll', () => {
  it('redeems a code once; a concurrent second redemption is refused', async () => {
    const { service, set } = build([
      { affected: 1, raw: [{ id: 7, name: 'w1' }] },
      { affected: 0, raw: [] },
    ]);

    const [first, second] = await Promise.allSettled([
      service.enroll({ code: 'brn_x', hostname: ' h ', version: '1.2' }),
      service.enroll({ code: 'brn_x' }),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(
      (first as PromiseFulfilledResult<{ workerId: number }>).value,
    ).toMatchObject({
      workerId: 7,
      name: 'w1',
    });
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(
      UnauthorizedException,
    );
    expect(set.mock.calls[0][0]).toMatchObject({
      hostname: 'h',
      version: '1.2',
      enrollCodeHash: null,
      enrollExpiresAt: null,
    });
  });

  it('refuses an expired or unknown code', async () => {
    const { service } = build([{ affected: 0, raw: [] }]);

    await expect(service.enroll({ code: 'brn_old' })).rejects.toThrow(
      'Invalid or expired enrollment code',
    );
  });
});
