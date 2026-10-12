import { randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CookieOptions } from 'express';

import { AuthProvider } from '../auth/entities/auth-identity.entity';

export const LINK_NONCE_COOKIE = 'oauth_link_nonce';
const STATE_TTL_SECONDS = 10 * 60;

interface LinkStatePayload {
  purpose: 'oauth-link';
  sub: number;
  provider: AuthProvider;
  nonce: string;
}

/**
 * CSRF protection for "connect another sign-in method" from the profile.
 * The state binds the flow to the signed-in user, and the same random nonce
 * rides in a cookie set by the (authenticated) start request: a callback
 * forged for a victim's browser carries the attacker's state but not a
 * matching cookie, so an attacker's provider account can't be linked to the
 * victim — nor the victim's to the attacker.
 */
@Injectable()
export class OauthLinkStateService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // A separate secret so a state token can never be accepted as an access token.
  private secret(): string {
    return `${this.configService.get<string>('REFRESH_JWT_SECRET') ?? ''}:oauth-link`;
  }

  create(
    userId: number,
    provider: AuthProvider,
  ): { state: string; nonce: string } {
    const nonce = randomBytes(16).toString('hex');
    const payload: LinkStatePayload = {
      purpose: 'oauth-link',
      sub: userId,
      provider,
      nonce,
    };
    const state = this.jwtService.sign(payload, {
      secret: this.secret(),
      expiresIn: STATE_TTL_SECONDS,
    });

    return { state, nonce };
  }

  /** The user the flow was started for, or null for anything forged, expired, mismatched or for another provider. */
  verify(
    state: string | undefined,
    nonceCookie: string | undefined,
    provider: AuthProvider,
  ): number | null {
    if (!state || !nonceCookie) {
      return null;
    }

    try {
      const payload = this.jwtService.verify<LinkStatePayload>(state, {
        secret: this.secret(),
      });

      if (
        payload.purpose !== 'oauth-link' ||
        payload.provider !== provider ||
        payload.nonce !== nonceCookie
      ) {
        return null;
      }

      return payload.sub;
    } catch {
      return null;
    }
  }

  cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') !== 'development',
      // Lax, not strict: the provider's redirect back is a cross-site top-level navigation.
      sameSite: 'lax',
      maxAge: STATE_TTL_SECONDS * 1000,
      domain: this.configService.get('COOKIE_DOMAIN'),
      path: '/api/v1/oauth',
    };
  }

  clearOptions(): CookieOptions {
    const options = this.cookieOptions();
    delete options.maxAge;

    return options;
  }
}
