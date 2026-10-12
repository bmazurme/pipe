import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { OauthLinkStateService } from './oauth-link-state.service';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { GithubStrategy } from './strategies/github.strategy';
import { YandexStrategy } from './strategies/yandex.strategy';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    PassportModule.register({ defaultStrategy: 'yandex' }),
  ],
  controllers: [OauthController],
  providers: [
    OauthService,
    OauthLinkStateService,
    YandexStrategy,
    GithubStrategy,
  ],
  exports: [OauthService],
})
export class OauthModule {}
