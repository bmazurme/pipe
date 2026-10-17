import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { SessionsService } from '../sessions.service';
import { JwtStrategy } from './jwt.strategy';

type Extractor = (request: {
  headers: { authorization?: string };
}) => string | null;

function createConfig(secret: string | undefined): ConfigService {
  return {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_SECRET' && secret !== undefined) return secret;
      throw new TypeError(`Configuration key "${key}" does not exist`);
    }),
  } as unknown as ConfigService;
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let isSessionActive: jest.Mock;

  beforeEach(() => {
    isSessionActive = jest.fn();
    strategy = new JwtStrategy(createConfig('test-secret'), {
      isSessionActive,
    } as unknown as SessionsService);
  });

  describe('validate', () => {
    it('rejects a payload without sub', async () => {
      await expect(
        strategy.validate({ sessionId: 1 } as JwtPayload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(isSessionActive).not.toHaveBeenCalled();
    });

    it('rejects a payload without sessionId', async () => {
      await expect(
        strategy.validate({ sub: 2 } as JwtPayload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(isSessionActive).not.toHaveBeenCalled();
    });

    it('rejects a token whose session was revoked or has expired', async () => {
      isSessionActive.mockResolvedValue(false);

      await expect(
        strategy.validate({ sub: 2, sessionId: 1 } as JwtPayload),
      ).rejects.toThrow(new UnauthorizedException('Session has been revoked'));
      expect(isSessionActive).toHaveBeenCalledWith(1, 2);
    });

    it('returns the user and session ids when the session is active', async () => {
      isSessionActive.mockResolvedValue(true);

      await expect(
        strategy.validate({ sub: 2, sessionId: 1 } as JwtPayload),
      ).resolves.toEqual({ id: 2, sessionId: 1 });
      expect(isSessionActive).toHaveBeenCalledWith(1, 2);
    });
  });

  describe('jwtFromRequest', () => {
    // passport-jwt keeps the configured extractor on this private field.
    const extractor = () =>
      (strategy as unknown as { _jwtFromRequest: Extractor })._jwtFromRequest;

    it('returns the token from a Bearer authorization header', () => {
      expect(
        extractor()({ headers: { authorization: 'Bearer abc.def.ghi' } }),
      ).toBe('abc.def.ghi');
    });

    it('returns null when the authorization header is missing', () => {
      expect(extractor()({ headers: {} })).toBeNull();
    });

    it('returns null for a non-Bearer scheme', () => {
      expect(
        extractor()({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }),
      ).toBeNull();
    });
  });

  describe('construction', () => {
    it('throws when JWT_SECRET is not configured instead of falling back to a default', () => {
      expect(
        () =>
          new JwtStrategy(
            createConfig(undefined),
            {} as unknown as SessionsService,
          ),
      ).toThrow('JWT_SECRET');
    });
  });
});
