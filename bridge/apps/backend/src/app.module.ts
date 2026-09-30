import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { OauthModule } from './oauth/oauth.module';
import { PurgeModule } from './purge/purge.module';
import { StorageModule } from './storage/storage.module';
import { TimeModule } from './time/time.module';
import { UsersModule } from './users/users.module';
import { WorkerModule } from './worker/worker.module';

import { TypeOrmModuleConfig } from './config/type-orm.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModuleConfig,
    AuthModule,
    OauthModule,
    PurgeModule,
    StorageModule,
    TimeModule,
    UsersModule,
    WorkerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
