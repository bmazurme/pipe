import { timingSafeEqual } from 'crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  // timingSafeEqual throws on a length mismatch rather than just returning
  // false, and the length check itself would otherwise leak via timing.
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/**
 * Guards machine-to-machine export routes with a static shared secret
 * (header `X-Api-Key`), for callers that aren't a logged-in browser session
 * and so can't go through JwtGuard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-api-key');
    const expected = this.configService.get<string>('TIME_EXPORT_API_KEY');

    if (!expected) {
      throw new UnauthorizedException('Export API key is not configured');
    }

    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
