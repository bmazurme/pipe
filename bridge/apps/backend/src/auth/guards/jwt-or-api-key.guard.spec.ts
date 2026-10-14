import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { API_KEY_PREFIX } from '../api-keys.service';
import { WORKER_KEY_PREFIX } from '../worker-keys.service';
import { JwtOrApiKeyGuard } from './jwt-or-api-key.guard';

function contextWithHeaders(headers: Record<string, string>): ExecutionContext {
  const request = { headers };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtOrApiKeyGuard', () => {
  let jwtGuard: { canActivate: jest.Mock };
  let apiKeysService: { validate: jest.Mock };
  let workerKeysService: { validate: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: JwtOrApiKeyGuard;

  beforeEach(() => {
    jwtGuard = { canActivate: jest.fn() };
    apiKeysService = { validate: jest.fn() };
    workerKeysService = { validate: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new JwtOrApiKeyGuard(
      jwtGuard as never,
      apiKeysService as never,
      workerKeysService as never,
      reflector as unknown as Reflector,
    );
  });

  describe('a worker key', () => {
    const workerContext = (key: string) => {
      const request: { headers: Record<string, string>; user?: unknown } = {
        headers: { authorization: `Bearer ${key}` },
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => undefined,
        getClass: () => undefined,
      } as unknown as ExecutionContext;

      return { request, context };
    };

    it('is refused on a route not marked for workers — before any lookup', async () => {
      const { context } = workerContext(`${WORKER_KEY_PREFIX}abc`);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(workerKeysService.validate).not.toHaveBeenCalled();
      expect(jwtGuard.canActivate).not.toHaveBeenCalled();
    });

    it('is accepted on a worker route and says which worker is calling', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      workerKeysService.validate.mockResolvedValue({ userId: 42, workerId: 7 });
      const { request, context } = workerContext(`${WORKER_KEY_PREFIX}abc`);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({ id: 42, workerId: 7 });
    });

    it('is rejected as unauthorised when the key matches no worker (deleted or never enrolled)', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      workerKeysService.validate.mockResolvedValue(null);
      const { context } = workerContext(`${WORKER_KEY_PREFIX}gone`);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('does not change how a personal API key is handled', async () => {
      apiKeysService.validate.mockResolvedValue({ userId: 1 });
      const request = { headers: { 'x-api-key': `${API_KEY_PREFIX}k` } };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(workerKeysService.validate).not.toHaveBeenCalled();
    });
  });

  it('delegates to JwtGuard when no API key is present, leaving it unaffected', async () => {
    jwtGuard.canActivate.mockResolvedValue(true);
    const context = contextWithHeaders({
      authorization: 'Bearer some.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtGuard.canActivate).toHaveBeenCalledWith(context);
    expect(apiKeysService.validate).not.toHaveBeenCalled();
  });

  it('propagates a JwtGuard rejection when there is no API key to fall back to', async () => {
    jwtGuard.canActivate.mockRejectedValue(new UnauthorizedException());
    const context = contextWithHeaders({
      authorization: 'Bearer bad.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('authenticates via X-Api-Key header without touching JwtGuard', async () => {
    apiKeysService.validate.mockResolvedValue({ userId: 42 });
    const request = { headers: { 'x-api-key': `${API_KEY_PREFIX}real-key` } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtGuard.canActivate).not.toHaveBeenCalled();
    expect((request as { user?: unknown }).user).toEqual({ id: 42 });
  });

  it('authenticates via an Authorization: Bearer header carrying an API key', async () => {
    apiKeysService.validate.mockResolvedValue({ userId: 42 });
    const context = contextWithHeaders({
      authorization: `Bearer ${API_KEY_PREFIX}real-key`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(apiKeysService.validate).toHaveBeenCalledWith(
      `${API_KEY_PREFIX}real-key`,
    );
  });

  it('rejects an invalid or revoked API key without falling through to JwtGuard', async () => {
    apiKeysService.validate.mockResolvedValue(null);
    const context = contextWithHeaders({
      'x-api-key': `${API_KEY_PREFIX}revoked-key`,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtGuard.canActivate).not.toHaveBeenCalled();
  });
});
