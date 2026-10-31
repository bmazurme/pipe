import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

import { LINK_NONCE_COOKIE } from './oauth-link-state.service';
import { OauthController } from './oauth.controller';

describe('OauthController', () => {
  const cookieOptions = { httpOnly: true, path: '/' };
  const clearOptions = { path: '/' };

  const oauthService = {
    link: jest.fn(),
    signin: jest.fn(),
  };
  const linkState = {
    create: jest.fn(),
    verify: jest.fn(),
    cookieOptions: jest.fn(),
    clearOptions: jest.fn(),
  };
  const env: Record<string, string | undefined> = {};
  const configService = {
    get: jest.fn((key: string) => env[key]),
  };

  const response = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };

  const profile = { provider: 'github', providerId: '1' };

  let controller: OauthController;

  const callbackRequest = (
    overrides: {
      query?: Record<string, unknown>;
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
      ip?: string;
    } = {},
  ) =>
    ({
      user: { profile },
      query: {},
      cookies: undefined,
      headers: {},
      ip: undefined,
      ...overrides,
    }) as unknown as Request & { user: { profile: never } };

  const callback = (req: ReturnType<typeof callbackRequest>) =>
    controller.githubLoginRedirect(
      req as never,
      response as unknown as Response,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(env)) delete env[key];
    linkState.cookieOptions.mockReturnValue(cookieOptions);
    linkState.clearOptions.mockReturnValue(clearOptions);
    controller = new OauthController(
      oauthService as never,
      linkState as never,
      configService as unknown as ConfigService,
    );
  });

  describe('providers', () => {
    it('returns only providers whose credential env var is set', () => {
      env.GITHUB_ID = 'gh';

      expect(controller.providers()).toEqual({ providers: ['github'] });

      env.YANDEX_ID = 'ya';
      expect(controller.providers().providers.sort()).toEqual([
        'github',
        'yandex',
      ]);

      delete env.GITHUB_ID;
      expect(controller.providers()).toEqual({ providers: ['yandex'] });
    });

    it('returns an empty list when nothing is configured', () => {
      expect(controller.providers()).toEqual({ providers: [] });
    });
  });

  describe('startLink', () => {
    it('rejects an unknown provider', () => {
      expect(() =>
        controller.startLink(
          'nope',
          { id: 1 },
          response as unknown as Response,
        ),
      ).toThrow(BadRequestException);
      expect(linkState.create).not.toHaveBeenCalled();
      expect(response.cookie).not.toHaveBeenCalled();
    });

    it('sets the nonce cookie and returns the state for a known provider', () => {
      linkState.create.mockReturnValue({ state: 'st', nonce: 'nn' });

      const result = controller.startLink(
        'github',
        { id: 7 },
        response as unknown as Response,
      );

      expect(linkState.create).toHaveBeenCalledWith(7, 'github');
      expect(response.cookie).toHaveBeenCalledWith(
        LINK_NONCE_COOKIE,
        'nn',
        cookieOptions,
      );
      expect(result).toEqual({ state: 'st' });
    });
  });

  describe('callback', () => {
    it('links (and never signs in) on a valid state, clearing the cookie', async () => {
      linkState.verify.mockReturnValue(42);
      oauthService.link.mockResolvedValue(undefined);

      await callback(
        callbackRequest({
          query: { state: 'st' },
          cookies: { [LINK_NONCE_COOKIE]: 'nn' },
        }),
      );

      expect(linkState.verify).toHaveBeenCalledWith('st', 'nn', 'github');
      expect(response.clearCookie).toHaveBeenCalledWith(
        LINK_NONCE_COOKIE,
        clearOptions,
      );
      expect(oauthService.link).toHaveBeenCalledWith(42, profile, response);
      expect(oauthService.signin).not.toHaveBeenCalled();
    });

    it('clears the cookie and throws on an invalid state, without link or signin', async () => {
      linkState.verify.mockReturnValue(null);

      await expect(
        callback(callbackRequest({ query: { state: 'bad' } })),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(linkState.verify).toHaveBeenCalledWith('bad', undefined, 'github');
      expect(response.clearCookie).toHaveBeenCalledWith(
        LINK_NONCE_COOKIE,
        clearOptions,
      );
      expect(oauthService.link).not.toHaveBeenCalled();
      expect(oauthService.signin).not.toHaveBeenCalled();
    });

    it('signs in with UA and ip when there is no state', async () => {
      oauthService.signin.mockResolvedValue(undefined);

      await callback(
        callbackRequest({
          headers: { 'user-agent': 'jest-agent' },
          ip: '1.2.3.4',
        }),
      );

      expect(oauthService.signin).toHaveBeenCalledWith(
        profile,
        response,
        'jest-agent',
        '1.2.3.4',
      );
      expect(oauthService.link).not.toHaveBeenCalled();
      expect(linkState.verify).not.toHaveBeenCalled();
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('passes null for a missing user agent and ip', async () => {
      oauthService.signin.mockResolvedValue(undefined);

      await callback(callbackRequest());

      expect(oauthService.signin).toHaveBeenCalledWith(
        profile,
        response,
        null,
        null,
      );
    });
  });
});
