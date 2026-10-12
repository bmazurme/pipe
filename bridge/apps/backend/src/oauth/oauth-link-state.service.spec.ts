import { JwtService } from '@nestjs/jwt';

import { OauthLinkStateService } from './oauth-link-state.service';

function make(refreshSecret = 'refresh-secret') {
  const config = {
    get: (key: string) =>
      ({ REFRESH_JWT_SECRET: refreshSecret, NODE_ENV: 'production' })[key],
  };

  return new OauthLinkStateService(
    new JwtService({ secret: 'jwt' }),
    config as never,
  );
}

describe('OauthLinkStateService', () => {
  it('accepts a state with the matching nonce cookie and returns its user', () => {
    const service = make();
    const { state, nonce } = service.create(7, 'github');

    expect(service.verify(state, nonce, 'github')).toBe(7);
  });

  it('rejects a state whose nonce cookie is missing or different (forged callback)', () => {
    const service = make();
    const { state } = service.create(7, 'github');

    expect(service.verify(state, undefined, 'github')).toBeNull();
    expect(service.verify(state, 'someone-elses-nonce', 'github')).toBeNull();
  });

  it('rejects a state minted for another provider', () => {
    const service = make();
    const { state, nonce } = service.create(7, 'yandex');

    expect(service.verify(state, nonce, 'github')).toBeNull();
  });

  it('rejects garbage and a state signed with another secret', () => {
    const { state, nonce } = make('other').create(7, 'github');

    expect(make().verify('not-a-jwt', nonce, 'github')).toBeNull();
    expect(make().verify(state, nonce, 'github')).toBeNull();
    expect(make().verify(undefined, nonce, 'github')).toBeNull();
  });

  it('is not an access token: signed with a derived secret, not JWT_SECRET', () => {
    const { state } = make().create(7, 'github');

    expect(() => new JwtService({ secret: 'jwt' }).verify(state)).toThrow();
    expect(() =>
      new JwtService({ secret: 'refresh-secret' }).verify(state),
    ).toThrow();
  });
});
