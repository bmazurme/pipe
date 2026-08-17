import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';

import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
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

  validate(payload: JwtPayload) {
    return { id: payload.sub };
  }
}
