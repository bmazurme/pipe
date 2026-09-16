import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiKeyGuard } from './api-key.guard';

function createContext(headerValue: string | undefined): ExecutionContext {
  const request = {
    header: (name: string) => (name === 'x-api-key' ? headerValue : undefined),
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  it('allows a request whose header matches the configured key', () => {
    const configService = {
      get: () => 'correct-key',
    } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(guard.canActivate(createContext('correct-key'))).toBe(true);
  });

  it('rejects a request with the wrong key', () => {
    const configService = {
      get: () => 'correct-key',
    } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(() => guard.canActivate(createContext('wrong-key'))).toThrow(
      'Invalid API key',
    );
  });

  it('rejects a request with no header at all', () => {
    const configService = {
      get: () => 'correct-key',
    } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(() => guard.canActivate(createContext(undefined))).toThrow(
      'Invalid API key',
    );
  });

  it('rejects every request when no key is configured', () => {
    const configService = { get: () => undefined } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(() => guard.canActivate(createContext('anything'))).toThrow(
      'Export API key is not configured',
    );
  });

  it('rejects a key of different length without throwing a raw crypto error', () => {
    const configService = {
      get: () => 'a-longer-correct-key',
    } as unknown as ConfigService;
    const guard = new ApiKeyGuard(configService);

    expect(() => guard.canActivate(createContext('short'))).toThrow(
      'Invalid API key',
    );
  });
});
