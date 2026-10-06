import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { LoopModule } from './loop/loop.module';
import { OauthModule } from './oauth/oauth.module';
import { PurgeModule } from './purge/purge.module';
import { SecretsModule } from './secrets/secrets.module';
import { StorageModule } from './storage/storage.module';
import { TimeModule } from './time/time.module';
import { UsersModule } from './users/users.module';
import { VpnModule } from './vpn/vpn.module';
import { WorkerModule } from './worker/worker.module';

import { TypeOrmModuleConfig } from './config/type-orm.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Global default — generous enough for legitimate polling: a single
    // browser with Worker+Chat+Storage all open at once peaks around 70-80
    // req/min, a single worker process's job+chat claim loop around 12/min.
    // AuthController overrides this with a much stricter 'default' throttle
    // of its own (see its class decorator) for the genuinely low-frequency,
    // brute-forceable routes (refresh, api-key creation) — JwtOrApiKeyGuard
    // routes (worker/chat claim, job/file/chat lists) stay on this looser
    // limit deliberately, since that's where all the real polling traffic
    // already lives and a stricter cap there would throttle normal use.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
    }),
    TypeOrmModuleConfig,
    AuthModule,
    ChatModule,
    LoopModule,
    OauthModule,
    PurgeModule,
    SecretsModule,
    StorageModule,
    TimeModule,
    UsersModule,
    VpnModule,
    WorkerModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
