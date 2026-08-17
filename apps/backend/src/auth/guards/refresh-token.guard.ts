import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UsersService } from '../../users/users.service';

@Injectable()
export class RefreshTokenGuard implements CanActivate {
  private readonly logger = new Logger(RefreshTokenGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const refreshToken = request.cookies?.refreshToken;

    if (!refreshToken) {
      this.logger.warn('Refresh token not found in cookies');
      throw new UnauthorizedException('Refresh token is required');
    }

    try {
      await this.validateRefreshToken(refreshToken);
      return true;
    } catch (error) {
      this.logger.warn(
        `Refresh token validation failed: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async validateRefreshToken(token: string): Promise<void> {
    const decoded = this.jwtService.verify<JwtPayload>(token, {
      secret: this.configService.get<string>('REFRESH_JWT_SECRET'),
    });

    if (!decoded.sub) {
      throw new UnauthorizedException(
        'Invalid refresh token payload: missing user ID',
      );
    }

    const isTokenValid = await this.usersService.isRefreshTokenValid(
      decoded.sub,
      token,
    );

    if (!isTokenValid) {
      throw new UnauthorizedException('Refresh token not found or expired');
    }
  }
}
