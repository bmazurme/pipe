import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { CookieOptions, Response } from 'express';

import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';

const CONFIG: Record<string, string> = {
  COOKIE_DOMAIN: 'api.bridge.ntlstl.dev',
  NODE_ENV: 'production',
  REFRESH_JWT_SECRET: 'refresh-secret',
};

type CookieCall = [string, string, CookieOptions];
type ClearCall = [string, CookieOptions];

describe('AuthService cookies', () => {
  let service: AuthService;
  let response: Response & { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: { sign: jest.fn(() => 'signed') } },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => CONFIG[key] },
        },
        { provide: SessionsService, useValue: {} },
      ],
    }).compile();

    service = module.get(AuthService);
    response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as typeof response;
  });

  it('writes the refresh token under the app-specific name', () => {
    service.setRefreshCookie(response, 'the-token');

    const [name, value] = response.cookie.mock.calls[0] as CookieCall;
    expect(name).toBe('bridgeRefreshToken');
    expect(value).toBe('the-token');
  });

  it('retires the legacy shared-name cookie whenever it issues a new one', () => {
    service.setRefreshCookie(response, 'the-token');

    const [name] = response.clearCookie.mock.calls[0] as ClearCall;
    expect(name).toBe('refreshToken');
  });

  // express's clearCookie sets expires to the epoch, then res.cookie
  // recomputes expires from maxAge — so passing the full cookie options
  // "cleared" a cookie by giving it an empty value and a 7-day life.
  it('omits maxAge when clearing, so the cookie is actually deleted', () => {
    service.clearRefreshCookie(response);

    for (const [, options] of response.clearCookie.mock.calls as ClearCall[]) {
      expect(options.maxAge).toBeUndefined();
    }
  });

  it('clears both names on logout, scoped like the originals', () => {
    service.clearRefreshCookie(response);

    const cleared = (response.clearCookie.mock.calls as ClearCall[]).map(
      ([name]) => name,
    );
    expect(cleared).toEqual(['bridgeRefreshToken', 'refreshToken']);

    for (const [, options] of response.clearCookie.mock.calls as ClearCall[]) {
      // Domain and path must match the original or the browser keeps it.
      expect(options.domain).toBe('api.bridge.ntlstl.dev');
      expect(options.path).toBe('/api/v1/auth');
    }
  });

  it('keeps the cookie httpOnly, secure and path-scoped outside development', () => {
    const options = service.getCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.path).toBe('/api/v1/auth');
  });
});
