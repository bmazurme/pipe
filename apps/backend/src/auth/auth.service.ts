import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CookieOptions, Request as CustomRequest, Response } from 'express';

import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { CheckAuthResponseDto } from './dto/check-auth.response.dto';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';
import { RefreshTokenNotFoundException } from './exceptions/refresh-token-not-found.exception';
import { JwtPayload } from './interfaces/jwt-payload.interface';

type AuthRequest = CustomRequest & {
  cookies?: { refreshToken?: string };
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
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
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = { sub: user.id };
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

  async logout(req: AuthRequest, response: Response) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new RefreshTokenNotFoundException();
    }

    response.clearCookie('refreshToken', this.getCookieOptions());

    return { message: 'Successfully logged out' };
  }

  async checkAuth(
    req: AuthRequest,
    res: Response,
  ): Promise<CheckAuthResponseDto> {
    try {
      const refreshToken = req.cookies?.refreshToken;

      if (!refreshToken) {
        return this.unauthorizedResponse(res);
      }

      const decoded = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('REFRESH_JWT_SECRET'),
      });

      if (!decoded.sub) {
        return this.unauthorizedResponse(res);
      }

      const currentUser =
        await this.usersService.findByRefreshToken(refreshToken);

      if (!currentUser) {
        return this.unauthorizedResponse(res);
      }

      const { accessToken } = await this.generateNewTokens(currentUser);

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

  async refreshTokens(req: AuthRequest, res: Response) {
    try {
      const refreshToken = req.cookies?.refreshToken;

      if (!refreshToken) {
        throw new RefreshTokenNotFoundException();
      }

      const user = await this.usersService.findByRefreshToken(refreshToken);

      if (!user) {
        throw new InvalidRefreshTokenException();
      }

      const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
        await this.generateNewTokens(user);
      await this.usersService.saveRefreshToken(user.id, newRefreshToken);

      res.cookie('refreshToken', newRefreshToken, this.getCookieOptions());

      return { accessToken: newAccessToken, expiresIn: '15m' };
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
}
