import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-github2';

import { OauthProfile } from '../oauth-profile';

interface GithubEmail {
  value: string;
  primary?: boolean;
  verified?: boolean;
}

/** Picks the primary verified email, else any verified one — an unverified address proves nothing. */
export function pickVerifiedEmail(
  emails: GithubEmail[] | undefined,
): string | null {
  const verified = (emails ?? []).filter((email) => email.verified === true);

  return (
    (verified.find((email) => email.primary) ?? verified[0])?.value ?? null
  );
}

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  private static readonly logger = new Logger(GithubStrategy.name);

  constructor(private readonly configService: ConfigService) {
    const clientID = configService.get<string>('GITHUB_ID');

    if (!clientID) {
      // Same reasoning as YandexStrategy: passport-oauth2 throws on a falsy
      // clientID, which would take the whole app down at boot.
      GithubStrategy.logger.warn(
        'GITHUB_ID is not configured — GitHub OAuth sign-in will not work, but the rest of the app will still start. ' +
          'Set GITHUB_ID/GITHUB_SECRET/BRIDGE_GITHUB_REDIRECT to enable it.',
      );
    }

    super({
      clientID: clientID || 'not-configured',
      clientSecret: configService.get<string>('GITHUB_SECRET') ?? '',
      callbackURL: configService.get<string>('BRIDGE_GITHUB_REDIRECT') ?? '',
      scope: ['user:email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (err: unknown, user?: { profile: OauthProfile }) => void,
  ): void {
    const email = pickVerifiedEmail(
      profile.emails as GithubEmail[] | undefined,
    );

    done(null, {
      profile: {
        provider: 'github',
        providerUserId: String(profile.id),
        email,
        emailVerified: email !== null,
      },
    });
  }
}
