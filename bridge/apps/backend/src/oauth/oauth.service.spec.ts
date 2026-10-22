import { ConflictException } from '@nestjs/common';

import { DeploymentAccessService } from '../auth/deployment-access';
import { OauthProfile } from './oauth-profile';
import { OauthService } from './oauth.service';

const TARGET = 'https://app.test';

const github = (over: Partial<OauthProfile> = {}): OauthProfile => ({
  provider: 'github',
  providerUserId: 'gh-1',
  email: 'a@b.c',
  emailVerified: true,
  ...over,
});

function setup(env: Record<string, string> = {}) {
  const usersService = {
    findByEmail: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue({ id: 3, email: 'b@x' }),
    create: jest.fn().mockResolvedValue({ id: 10 }),
  };
  const identitiesService = {
    findByProviderUserId: jest.fn().mockResolvedValue(null),
    findLegacy: jest.fn().mockResolvedValue(null),
    findByUserAndProvider: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    markUsed: jest.fn().mockResolvedValue(undefined),
    link: jest.fn().mockResolvedValue({}),
  };
  const authService = {
    generateNewTokens: jest.fn().mockResolvedValue({ refreshToken: 'rt' }),
    setRefreshCookie: jest.fn(),
  };
  const sessionsService = {
    createSession: jest.fn().mockResolvedValue({ id: 5 }),
    attachRefreshToken: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: (key: string) => ({ BRIDGE_TARGET_URL: TARGET, ...env })[key],
  };
  const response = { redirect: jest.fn() };
  const service = new OauthService(
    usersService as never,
    identitiesService as never,
    authService as never,
    sessionsService as never,
    config as never,
    new DeploymentAccessService(usersService as never, config as never),
  );

  return {
    service,
    usersService,
    identitiesService,
    authService,
    sessionsService,
    response,
  };
}

describe('OauthService.signin', () => {
  it('signs in a known account by its provider id and records the use', async () => {
    const s = setup();
    const known = { id: 1, userId: 3, enabled: true };
    s.identitiesService.findByProviderUserId.mockResolvedValue(known);

    await s.service.signin(github(), s.response as never, 'ua', '1.1.1.1');

    expect(s.identitiesService.markUsed).toHaveBeenCalledWith(
      known,
      'gh-1',
      'a@b.c',
    );
    expect(s.sessionsService.createSession).toHaveBeenCalledWith(
      3,
      'ua',
      '1.1.1.1',
    );
    expect(s.response.redirect).toHaveBeenCalledWith(TARGET);
  });

  it('blocks an already linked account whose user email left EMAILS and starts no session', async () => {
    const s = setup({ EMAILS: 'a@x' });
    s.identitiesService.findByProviderUserId.mockResolvedValue({
      id: 1,
      userId: 3,
      enabled: true,
    });

    await s.service.signin(github(), s.response as never, 'ua', '1.1.1.1');

    expect(s.response.redirect).toHaveBeenCalledWith(`${TARGET}/oauth-error`);
    expect(s.identitiesService.markUsed).not.toHaveBeenCalled();
    expect(s.sessionsService.createSession).not.toHaveBeenCalled();
  });

  it('still signs in an already linked account when EMAILS is empty', async () => {
    const s = setup({ EMAILS: '' });
    s.identitiesService.findByProviderUserId.mockResolvedValue({
      id: 1,
      userId: 3,
      enabled: true,
    });

    await s.service.signin(github(), s.response as never, 'ua', '1.1.1.1');

    expect(s.usersService.findById).not.toHaveBeenCalled();
    expect(s.sessionsService.createSession).toHaveBeenCalledWith(
      3,
      'ua',
      '1.1.1.1',
    );
    expect(s.response.redirect).toHaveBeenCalledWith(TARGET);
  });

  it('blocks a disabled method and starts no session', async () => {
    const s = setup();
    s.identitiesService.findByProviderUserId.mockResolvedValue({
      id: 1,
      userId: 3,
      enabled: false,
    });

    await s.service.signin(github(), s.response as never, null, null);

    expect(s.response.redirect).toHaveBeenCalledWith(
      `${TARGET}/oauth-error?reason=disabled`,
    );
    expect(s.sessionsService.createSession).not.toHaveBeenCalled();
  });

  it('upgrades a backfilled Yandex identity to the real provider id on first sign-in', async () => {
    const s = setup();
    const legacy = { id: 1, userId: 3, enabled: true };
    s.identitiesService.findLegacy.mockResolvedValue(legacy);

    await s.service.signin(
      {
        provider: 'yandex',
        providerUserId: '555',
        email: 'a@b.c',
        emailVerified: true,
      },
      s.response as never,
      null,
      null,
    );

    expect(s.identitiesService.markUsed).toHaveBeenCalledWith(
      legacy,
      '555',
      'a@b.c',
    );
    expect(s.response.redirect).toHaveBeenCalledWith(TARGET);
  });

  it('does not look for a legacy row for GitHub', async () => {
    const s = setup();

    await s.service.signin(github(), s.response as never, null, null);

    expect(s.identitiesService.findLegacy).not.toHaveBeenCalled();
  });

  it('refuses a new account without a verified email', async () => {
    const s = setup();

    await s.service.signin(
      github({ email: null, emailVerified: false }),
      s.response as never,
      null,
      null,
    );

    expect(s.response.redirect).toHaveBeenCalledWith(
      `${TARGET}/oauth-error?reason=unverified`,
    );
    expect(s.usersService.create).not.toHaveBeenCalled();
  });

  it('refuses a new account outside the EMAILS allowlist', async () => {
    const s = setup({ EMAILS: 'someone@else.c' });

    await s.service.signin(github(), s.response as never, null, null);

    expect(s.response.redirect).toHaveBeenCalledWith(`${TARGET}/oauth-error`);
    expect(s.usersService.create).not.toHaveBeenCalled();
  });

  it('attaches a new GitHub account to the existing user with that verified, allowed email', async () => {
    const s = setup({ EMAILS: 'a@b.c' });
    s.usersService.findByEmail.mockResolvedValue({ id: 3 });

    await s.service.signin(github(), s.response as never, null, null);

    expect(s.usersService.create).not.toHaveBeenCalled();
    expect(s.identitiesService.create).toHaveBeenCalledWith(
      3,
      'github',
      'gh-1',
      'a@b.c',
    );
    expect(s.sessionsService.createSession).toHaveBeenCalledWith(3, null, null);
  });

  it('refuses when that user already has another account of the provider linked', async () => {
    const s = setup();
    s.usersService.findByEmail.mockResolvedValue({ id: 3 });
    s.identitiesService.findByUserAndProvider.mockResolvedValue({ id: 9 });

    await s.service.signin(github(), s.response as never, null, null);

    expect(s.response.redirect).toHaveBeenCalledWith(
      `${TARGET}/oauth-error?reason=conflict`,
    );
    expect(s.identitiesService.create).not.toHaveBeenCalled();
  });

  it('creates the user and the identity for a brand-new allowed account', async () => {
    const s = setup();

    await s.service.signin(github(), s.response as never, null, null);

    expect(s.usersService.create).toHaveBeenCalledWith({ email: 'a@b.c' });
    expect(s.identitiesService.create).toHaveBeenCalledWith(
      10,
      'github',
      'gh-1',
      'a@b.c',
    );
  });
});

describe('OauthService.link', () => {
  it('sends the browser back to the profile with the linked provider', async () => {
    const s = setup();

    await s.service.link(3, github(), s.response as never);

    expect(s.identitiesService.link).toHaveBeenCalledWith(
      3,
      'github',
      'gh-1',
      'a@b.c',
    );
    expect(s.response.redirect).toHaveBeenCalledWith(
      `${TARGET}/profile?tab=access&linked=github`,
    );
    expect(s.sessionsService.createSession).not.toHaveBeenCalled();
  });

  it('reports a refused link on the profile instead of failing the request', async () => {
    const s = setup();
    s.identitiesService.link.mockRejectedValue(new ConflictException('занят'));

    await s.service.link(3, github(), s.response as never);

    expect(s.response.redirect).toHaveBeenCalledWith(
      `${TARGET}/profile?tab=access&linkError=${encodeURIComponent('занят')}`,
    );
  });
});
