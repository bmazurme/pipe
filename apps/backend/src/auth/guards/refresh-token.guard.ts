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
import { Session } from '../entities/session.entity';
import { SessionsService } from '../sessions.service';

export type AuthSession = {
  userId: number;
  sessionId: number;
  session: Session;
};

export type RequestWithAuthSession = Request & { authSession?: AuthSession };

@Injectable()
export class RefreshTokenGuard implements CanActivate {
  private readonly logger = new Logger(RefreshTokenGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionsService: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuthSession>();
    const refreshToken = request.cookies?.refreshToken;

    if (!refreshToken) {
      this.logger.warn('Refresh token not found in cookies');
      throw new UnauthorizedException('Refresh token is required');
    }

    try {
      request.authSession = await this.validateRefreshToken(refreshToken);
      return true;
    } catch (error) {
      this.logger.warn(
        `Refresh token validation failed: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async validateRefreshToken(token: string): Promise<AuthSession> {
    const decoded = this.jwtService.verify<JwtPayload>(token, {
      secret: this.configService.get<string>('REFRESH_JWT_SECRET'),
    });

    if (!decoded.sub || decoded.sessionId === undefined) {
      throw new UnauthorizedException(
        'Invalid refresh token payload: missing user or session ID',
      );
    }

    const session = await this.sessionsService.validateSession(
      decoded.sessionId,
      decoded.sub,
      token,
    );

    if (!session) {
      throw new UnauthorizedException('Refresh token not found or expired');
    }

    return { userId: decoded.sub, sessionId: decoded.sessionId, session };
  }
}
