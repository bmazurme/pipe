import {
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { CookieOptions, Response } from 'express';

import { TelegramService } from '../telegram/telegram.service';
import { AuthService } from './auth.service';
import { DeploymentAccessService } from './deployment-access';
import { EmergencyKeysService } from './emergency-keys.service';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';
import { RefreshTokenNotFoundException } from './exceptions/refresh-token-not-found.exception';
import { RequestWithAuthSession } from './guards/refresh-token.guard';
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
        { provide: EmergencyKeysService, useValue: {} },
        { provide: DeploymentAccessService, useValue: {} },
        { provide: TelegramService, useValue: { send: jest.fn() } },
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

describe('AuthService sessions and token refresh', () => {
  let service: AuthService;
  let jwtService: { sign: jest.Mock };
  let sessionsService: {
    attachRefreshToken: jest.Mock;
    revoke: jest.Mock;
    createSession: jest.Mock;
  };
  let emergencyKeys: { redeem: jest.Mock };
  let deploymentAccess: { isUserAllowed: jest.Mock };
  let telegram: { send: jest.Mock };
  let response: Response & { cookie: jest.Mock; clearCookie: jest.Mock };

  const authReq = (): RequestWithAuthSession =>
    ({
      authSession: { userId: 7, sessionId: 3 },
    }) as unknown as RequestWithAuthSession;

  beforeEach(async () => {
    jwtService = {
      sign: jest.fn((_payload: unknown, options: { secret?: string }) =>
        options.secret ? 'new-refresh' : 'new-access',
      ),
    };
    sessionsService = {
      attachRefreshToken: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(true),
      createSession: jest.fn().mockResolvedValue({ id: 42 }),
    };
    emergencyKeys = { redeem: jest.fn() };
    deploymentAccess = { isUserAllowed: jest.fn().mockResolvedValue(true) };
    telegram = { send: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => CONFIG[key] },
        },
        { provide: SessionsService, useValue: sessionsService },
        { provide: EmergencyKeysService, useValue: emergencyKeys },
        { provide: TelegramService, useValue: telegram },
        { provide: DeploymentAccessService, useValue: deploymentAccess },
      ],
    }).compile();

    service = module.get(AuthService);
    response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as typeof response;
  });

  describe('signInWithEmergencyKey', () => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    it('rejects a key that does not match, sets no cookie and creates no session', async () => {
      emergencyKeys.redeem.mockResolvedValue(null);

      await expect(
        service.signInWithEmergencyKey('bre_wrong', response, 'ua', '1.2.3.4'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessionsService.createSession).not.toHaveBeenCalled();
      expect(response.cookie).not.toHaveBeenCalled();
      expect(telegram.send).not.toHaveBeenCalled();
    });

    it('turns a valid key into an ordinary session: a refresh cookie for that user', async () => {
      emergencyKeys.redeem.mockResolvedValue(7);

      const result = await service.signInWithEmergencyKey(
        'bre_good',
        response,
        'Mozilla',
        '1.2.3.4',
      );

      expect(result).toEqual({ isAuthenticated: true });
      expect(sessionsService.createSession).toHaveBeenCalledWith(
        7,
        'Mozilla',
        '1.2.3.4',
      );
      expect(sessionsService.attachRefreshToken).toHaveBeenCalledWith(
        42,
        'new-refresh',
      );
      expect(response.cookie).toHaveBeenCalledTimes(1);
    });

    it('rejects a valid key of a user no longer in EMAILS with the generic 401 and creates no session', async () => {
      emergencyKeys.redeem.mockResolvedValue(7);
      deploymentAccess.isUserAllowed.mockResolvedValue(false);

      await expect(
        service.signInWithEmergencyKey('bre_good', response, 'ua', '1.2.3.4'),
      ).rejects.toThrow(new UnauthorizedException('Invalid emergency key'));
      expect(deploymentAccess.isUserAllowed).toHaveBeenCalledWith(7);
      expect(sessionsService.createSession).not.toHaveBeenCalled();
      expect(response.cookie).not.toHaveBeenCalled();
      expect(telegram.send).not.toHaveBeenCalled();
    });

    it('tells Telegram at once that the emergency key was used, with the address', async () => {
      emergencyKeys.redeem.mockResolvedValue(7);

      await service.signInWithEmergencyKey(
        'bre_good',
        response,
        null,
        '9.9.9.9',
      );

      expect(telegram.send).toHaveBeenCalledTimes(1);
      expect(telegram.send.mock.calls[0][0]).toContain('9.9.9.9');
    });

    it('still signs in when Telegram is down (the alert is best-effort)', async () => {
      emergencyKeys.redeem.mockResolvedValue(7);
      telegram.send.mockRejectedValue(new Error('telegram unreachable'));

      await expect(
        service.signInWithEmergencyKey('bre_good', response, null, '9.9.9.9'),
      ).resolves.toEqual({ isAuthenticated: true });
    });
  });

  describe('refreshTokens', () => {
    it('rejects with RefreshTokenNotFoundException without an authSession', async () => {
      const req = {} as RequestWithAuthSession;

      await expect(service.refreshTokens(req, response)).rejects.toBeInstanceOf(
        RefreshTokenNotFoundException,
      );
      expect(response.cookie).not.toHaveBeenCalled();
    });

    it('returns a new access token, attaches the refresh token and sets the cookie', async () => {
      const result = await service.refreshTokens(authReq(), response);

      expect(result).toEqual({ accessToken: 'new-access', expiresIn: '15m' });
      expect(sessionsService.attachRefreshToken).toHaveBeenCalledTimes(1);
      expect(sessionsService.attachRefreshToken).toHaveBeenCalledWith(
        3,
        'new-refresh',
      );
      const [name, value] = response.cookie.mock.calls[0] as CookieCall;
      expect(name).toBe('bridgeRefreshToken');
      expect(value).toBe('new-refresh');
    });

    it('signs the refresh token with the refresh secret and 7d expiry', async () => {
      await service.refreshTokens(authReq(), response);

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 7, sessionId: 3 },
        { secret: 'refresh-secret', expiresIn: '7d' },
      );
    });

    it('maps a plain error from attachRefreshToken to InvalidRefreshTokenException', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      sessionsService.attachRefreshToken.mockRejectedValue(new Error('boom'));

      await expect(
        service.refreshTokens(authReq(), response),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
      expect(response.cookie).not.toHaveBeenCalled();
    });

    it('rethrows an HttpException from attachRefreshToken unchanged', async () => {
      const error = new UnauthorizedException('nope');
      sessionsService.attachRefreshToken.mockRejectedValue(error);

      await expect(service.refreshTokens(authReq(), response)).rejects.toBe(
        error,
      );
      expect(response.cookie).not.toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    it('refuses to revoke the current session', async () => {
      await expect(service.revokeSession(7, 3, 3)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(sessionsService.revoke).not.toHaveBeenCalled();
    });

    it('gives 404 for an unknown session', async () => {
      sessionsService.revoke.mockResolvedValue(false);

      await expect(service.revokeSession(7, 99, 3)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(sessionsService.revoke).toHaveBeenCalledWith(99, 7);
    });

    it('revokes another session of the user', async () => {
      await expect(service.revokeSession(7, 4, 3)).resolves.toEqual({
        message: 'Session revoked',
      });
    });
  });

  describe('logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const result = await service.logout(authReq(), response);

      expect(sessionsService.revoke).toHaveBeenCalledWith(3, 7);
      const cleared = (response.clearCookie.mock.calls as ClearCall[]).map(
        ([name]) => name,
      );
      expect(cleared).toEqual(['bridgeRefreshToken', 'refreshToken']);
      expect(result).toEqual({ message: 'Successfully logged out' });
    });

    it('still clears the cookie without a session', async () => {
      await service.logout({} as RequestWithAuthSession, response);

      expect(sessionsService.revoke).not.toHaveBeenCalled();
      expect(response.clearCookie).toHaveBeenCalled();
    });
  });

  describe('announceCredentialCreated', () => {
    it('sends one Telegram line for an emergency key, with user and address', () => {
      service.announceCredentialCreated('emergency', 7, undefined, '9.9.9.9');

      expect(telegram.send).toHaveBeenCalledTimes(1);
      const text = telegram.send.mock.calls[0][0] as string;
      expect(text).toContain('7');
      expect(text).toContain('9.9.9.9');
    });

    it('names the API key and its expiry', () => {
      service.announceCredentialCreated(
        'api-key',
        7,
        'ci-key',
        '9.9.9.9',
        'boards',
        null,
      );

      expect(telegram.send).toHaveBeenCalledTimes(1);
      const text = telegram.send.mock.calls[0][0] as string;
      expect(text).toContain('ci-key');
      expect(text).toContain('бессрочный');
    });

    it('does not throw when Telegram rejects', async () => {
      telegram.send.mockRejectedValue(new Error('telegram unreachable'));

      expect(() =>
        service.announceCredentialCreated('emergency', 7, undefined, null),
      ).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
    });
  });
});
