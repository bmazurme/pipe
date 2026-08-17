import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-yandex';

@Injectable()
export class YandexStrategy extends PassportStrategy(Strategy, 'yandex') {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.get<string>('YANDEX_ID') ?? '',
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
