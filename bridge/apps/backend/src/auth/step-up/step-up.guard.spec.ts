import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { StepUpGuard } from './step-up.guard';

function makeContext(request: object, required = true): ExecutionContext {
  const handler = () => undefined;

  Reflect.defineMetadata('requireStepUp', required, handler);

  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function make(
  stepUp: Partial<
    Record<'isEnabled' | 'enforced' | 'checkGrant' | 'audit', jest.Mock>
  > = {},
) {
  const service = {
    isEnabled: jest.fn().mockResolvedValue(true),
    enforced: jest.fn().mockReturnValue(false),
    checkGrant: jest.fn().mockReturnValue(true),
    audit: jest.fn(),
    ...stepUp,
  };

  return { guard: new StepUpGuard(service as any, new Reflector()), service };
}

const browser = { id: 1, sessionId: 9 };

describe('StepUpGuard', () => {
  it('lets a route without the marker through untouched', async () => {
    const { guard, service } = make();

    await expect(
      guard.canActivate(makeContext({ user: browser, headers: {} }, false)),
    ).resolves.toBe(true);
    expect(service.isEnabled).not.toHaveBeenCalled();
  });

  it('answers STEP_UP_REQUIRED without a grant', async () => {
    const { guard } = make();
    const request = { user: browser, headers: {}, method: 'GET', path: '/x' };

    await expect(guard.canActivate(makeContext(request))).rejects.toMatchObject(
      {
        response: { code: 'STEP_UP_REQUIRED' },
        status: 403,
      },
    );
  });

  it('answers STEP_UP_REQUIRED with a grant that does not check out (expired, other session)', async () => {
    const { guard, service } = make({
      checkGrant: jest.fn().mockReturnValue(false),
    });
    const request = {
      user: browser,
      headers: { 'x-step-up': 'old' },
      method: 'GET',
      path: '/x',
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.checkGrant).toHaveBeenCalledWith('old', 1, 9);
  });

  it('lets a valid grant through and writes the audit record', async () => {
    const { guard, service } = make();
    const request = {
      user: browser,
      headers: { 'x-step-up': 'good' },
      method: 'GET',
      route: { path: '/api/v1/secrets/:id/value' },
      path: '/api/v1/secrets/5/value',
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(service.audit).toHaveBeenCalledWith(
      'info',
      'stepup.action',
      'GET /api/v1/secrets/:id/value confirmed',
      { userId: 1 },
    );
  });

  it('passes, with a warning in the audit log, while two-factor is not set up', async () => {
    const { guard, service } = make({
      isEnabled: jest.fn().mockResolvedValue(false),
    });
    const request = {
      user: browser,
      headers: {},
      method: 'DELETE',
      path: '/x',
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(service.audit).toHaveBeenCalledWith(
      'warn',
      'stepup.skipped',
      expect.any(String),
      { userId: 1 },
    );
  });

  it('refuses while not set up when enforcement is on', async () => {
    const { guard } = make({
      isEnabled: jest.fn().mockResolvedValue(false),
      enforced: jest.fn().mockReturnValue(true),
    });
    const request = {
      user: browser,
      headers: {},
      method: 'DELETE',
      path: '/x',
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toMatchObject(
      {
        response: { code: 'STEP_UP_NOT_ENROLLED' },
      },
    );
  });

  it('does not ask a machine caller (no browser session) for a code', async () => {
    const { guard, service } = make();

    await expect(
      guard.canActivate(makeContext({ user: { id: 1 }, headers: {} })),
    ).resolves.toBe(true);
    expect(service.isEnabled).not.toHaveBeenCalled();
  });

  it('refuses when nobody is authenticated', async () => {
    const { guard } = make();

    await expect(
      guard.canActivate(makeContext({ headers: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
