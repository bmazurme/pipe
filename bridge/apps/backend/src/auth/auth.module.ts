import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';

import { ApiKeysService } from './api-keys.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmergencyKeysService } from './emergency-keys.service';
import { ApiKey } from './entities/api-key.entity';
import { AuthIdentity } from './entities/auth-identity.entity';
import { EmergencyKey } from './entities/emergency-key.entity';
import { DeploymentAccessService } from './deployment-access';
import { Session } from './entities/session.entity';
import { IdentitiesController } from './identities.controller';
import { IdentitiesService } from './identities.service';
import { JwtOrApiKeyGuard } from './guards/jwt-or-api-key.guard';
import { JwtGuard } from './guards/jwt.guard';
import { OwnerGuard } from './guards/owner.guard';
import { SessionsService } from './sessions.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, ApiKey, AuthIdentity, EmergencyKey]),
    TelegramModule,
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET is not configured');
        }
        return {
          secret,
          signOptions: { expiresIn: '15m' },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, IdentitiesController],
  providers: [
    AuthService,
    JwtStrategy,
    SessionsService,
    ApiKeysService,
    EmergencyKeysService,
    IdentitiesService,
    JwtGuard,
    JwtOrApiKeyGuard,
    DeploymentAccessService,
    OwnerGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    SessionsService,
    ApiKeysService,
    IdentitiesService,
    JwtGuard,
    JwtOrApiKeyGuard,
    DeploymentAccessService,
    OwnerGuard,
  ],
})
export class AuthModule {}
