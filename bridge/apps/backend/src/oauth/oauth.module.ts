import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { YandexStrategy } from './strategies/yandex.strategy';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    PassportModule.register({ defaultStrategy: 'yandex' }),
  ],
  controllers: [OauthController],
  providers: [OauthService, YandexStrategy],
  exports: [OauthService],
})
export class OauthModule {}
