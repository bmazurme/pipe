import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { OauthModule } from './oauth/oauth.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

import { TypeOrmModuleConfig } from './config/type-orm.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModuleConfig,
    AuthModule,
    OauthModule,
    StorageModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
