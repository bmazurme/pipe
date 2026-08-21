import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import { REFRESH_COOKIE_NAME } from '../refresh-cookie';
import { SessionsService } from '../sessions.service';
import { RefreshTokenGuard } from './refresh-token.guard';

const VALID = 'valid-token';
const FOREIGN = 'token-from-a-sibling-app';

function contextWithCookieHeader(cookie?: string): ExecutionContext {
  const request = { headers: cookie === undefined ? {} : { cookie } };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RefreshTokenGuard', () => {
  let guard: RefreshTokenGuard;
  let sessionsService: { validateSession: jest.Mock };

  beforeEach(async () => {
    sessionsService = { validateSession: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenGuard,
        {
          provide: JwtService,
          useValue: {
            // Only our own token carries a usable signature; anything else
            // throws exactly the way jsonwebtoken does for a foreign secret.
            verify: jest.fn((token: string) => {
              if (token !== VALID) {
                throw new Error('invalid signature');
              }
              return { sub: 2, sessionId: 7 };
            }),
          },
        },
        { provide: ConfigService, useValue: { get: () => 'refresh-secret' } },
        { provide: SessionsService, useValue: sessionsService },
      ],
    }).compile();

    guard = module.get(RefreshTokenGuard);
    sessionsService.validateSession.mockResolvedValue({ id: 7, userId: 2 });
  });

  it('accepts the refresh cookie under its own name', async () => {
    const context = contextWithCookieHeader(`${REFRESH_COOKIE_NAME}=${VALID}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('ignores the legacy shared-name cookie entirely', async () => {
    const context = contextWithCookieHeader(`refreshToken=${VALID}`);

    // The rename is what makes a sibling app's cookie a non-event.
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // The production failure, reproduced: a valid cookie present but not first.
  it('still authenticates when a same-name cookie shadows ours', async () => {
    const context = contextWithCookieHeader(
      `${REFRESH_COOKIE_NAME}=${FOREIGN}; ${REFRESH_COOKIE_NAME}=${VALID}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects when every candidate fails, without falling through', async () => {
    const context = contextWithCookieHeader(
      `${REFRESH_COOKIE_NAME}=${FOREIGN}; ${REFRESH_COOKIE_NAME}=also-bad`,
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when no refresh cookie is present at all', async () => {
    await expect(guard.canActivate(contextWithCookieHeader())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose session no longer validates', async () => {
    sessionsService.validateSession.mockResolvedValue(null);
    const context = contextWithCookieHeader(`${REFRESH_COOKIE_NAME}=${VALID}`);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches the resolved session to the request', async () => {
    const request = {
      headers: { cookie: `${REFRESH_COOKIE_NAME}=${VALID}` },
    } as Record<string, unknown>;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await guard.canActivate(context);

    expect(request.authSession).toEqual({
      userId: 2,
      sessionId: 7,
      session: { id: 7, userId: 2 },
    });
  });
});
