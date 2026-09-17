import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-yandex';

@Injectable()
export class YandexStrategy extends PassportStrategy(Strategy, 'yandex') {
  private static readonly logger = new Logger(YandexStrategy.name);

  constructor(private readonly configService: ConfigService) {
    const clientID = configService.get<string>('YANDEX_ID');

    if (!clientID) {
      // passport-oauth2's Strategy constructor throws synchronously if
      // clientID is falsy, which would otherwise take down the entire Nest
      // app at boot — not just the OAuth flow — for anyone running without
      // a real Yandex app configured (e.g. local dev on a fresh checkout).
      // A placeholder lets everything else start; only an actual sign-in
      // attempt fails, with a clear reason, instead of the whole server.
      YandexStrategy.logger.warn(
        'YANDEX_ID is not configured — Yandex OAuth sign-in will not work, but the rest of the app will still start. ' +
          'Set YANDEX_ID/YANDEX_SECRET in .env to enable it.',
      );
    }

    super({
      clientID: clientID || 'not-configured',
      clientSecret: configService.get<string>('YANDEX_SECRET') ?? '',
      callbackURL: configService.get<string>('NOTES_YANDEX_REDIRECT') ?? '',
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (err: any, user: any, info?: any) => void,
  ): any {
    const { default_email: email } = profile._json;
    const payload = {
      user: { email },
      accessToken,
    };

    done(null, payload);
  }
}
