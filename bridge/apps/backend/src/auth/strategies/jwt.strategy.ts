import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';

import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { SessionsService } from '../sessions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly sessionsService: SessionsService,
  ) {
    super({
      jwtFromRequest: (request: { headers: { authorization?: string } }) => {
        const authHeader = request.headers.authorization;

        if (authHeader?.startsWith('Bearer ')) {
          return authHeader.split(' ')[1];
        }

        return null;
      },
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'SECRET',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || payload.sessionId === undefined) {
      throw new UnauthorizedException();
    }

    const isActive = await this.sessionsService.isSessionActive(
      payload.sessionId,
      payload.sub,
    );

    if (!isActive) {
      throw new UnauthorizedException('Session has been revoked');
    }

    return { id: payload.sub, sessionId: payload.sessionId };
  }
}
