import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApiKeysService } from './api-keys.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ApiKey } from './entities/api-key.entity';
import { Session } from './entities/session.entity';
import { JwtOrApiKeyGuard } from './guards/jwt-or-api-key.guard';
import { JwtGuard } from './guards/jwt.guard';
import { SessionsService } from './sessions.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, ApiKey]),
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
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    SessionsService,
    ApiKeysService,
    JwtGuard,
    JwtOrApiKeyGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    SessionsService,
    ApiKeysService,
    JwtGuard,
    JwtOrApiKeyGuard,
  ],
})
export class AuthModule {}
