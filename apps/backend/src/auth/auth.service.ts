import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CookieOptions, Response } from 'express';

import { CheckAuthResponseDto } from './dto/check-auth.response.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';
import { RefreshTokenNotFoundException } from './exceptions/refresh-token-not-found.exception';
import { RequestWithAuthSession } from './guards/refresh-token.guard';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { SessionsService } from './sessions.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionsService: SessionsService,
  ) {}

  getCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') !== 'development',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: this.configService.get('COOKIE_DOMAIN'),
      path: '/api/v1/auth',
    };
  }

  private signAccessToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }

  async generateNewTokens(
    userId: number,
    sessionId: number,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = { sub: userId, sessionId };
    const accessToken = this.signAccessToken(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('REFRESH_JWT_SECRET'),
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  private unauthorizedResponse(response: Response): CheckAuthResponseDto {
    response.status(HttpStatus.UNAUTHORIZED);
    return { isAuthenticated: false };
  }

  async logout(req: RequestWithAuthSession, response: Response) {
    const authSession = req.authSession;

    if (authSession) {
      await this.sessionsService.revoke(
        authSession.sessionId,
        authSession.userId,
      );
    }

    response.clearCookie('refreshToken', this.getCookieOptions());

    return { message: 'Successfully logged out' };
  }

  async checkAuth(
    req: RequestWithAuthSession,
    res: Response,
  ): Promise<CheckAuthResponseDto> {
    try {
      const authSession = req.authSession;

      if (!authSession) {
        return this.unauthorizedResponse(res);
      }

      const { accessToken } = await this.generateNewTokens(
        authSession.userId,
        authSession.sessionId,
      );

      res.status(HttpStatus.OK);

      return { accessToken, isAuthenticated: true };
    } catch (error) {
      this.logger.error(
        'Error in checkAuth:',
        error instanceof Error ? error.stack : String(error),
      );
      return this.unauthorizedResponse(res);
    }
  }

  async refreshTokens(req: RequestWithAuthSession, res: Response) {
    try {
      const authSession = req.authSession;

      if (!authSession) {
        throw new RefreshTokenNotFoundException();
      }

      const { accessToken, refreshToken } = await this.generateNewTokens(
        authSession.userId,
        authSession.sessionId,
      );
      await this.sessionsService.attachRefreshToken(
        authSession.sessionId,
        refreshToken,
      );

      res.cookie('refreshToken', refreshToken, this.getCookieOptions());

      return { accessToken, expiresIn: '15m' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        'Error in refreshTokens:',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InvalidRefreshTokenException();
    }
  }

  async listSessions(
    userId: number,
    currentSessionId: number,
  ): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionsService.findActiveByUser(userId);

    return sessions.map((session) =>
      SessionResponseDto.fromSession(session, currentSessionId),
    );
  }

  async revokeSession(
    userId: number,
    targetSessionId: number,
    currentSessionId: number,
  ): Promise<{ message: string }> {
    if (targetSessionId === currentSessionId) {
      throw new ForbiddenException('Use logout to end the current session');
    }

    const revoked = await this.sessionsService.revoke(targetSessionId, userId);

    if (!revoked) {
      throw new NotFoundException('Session not found');
    }

    return { message: 'Session revoked' };
  }
}
