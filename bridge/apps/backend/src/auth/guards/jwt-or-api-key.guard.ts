import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

import { API_KEY_PREFIX, ApiKeysService } from '../api-keys.service';
import { JwtGuard } from './jwt.guard';

function extractCandidate(request: Request): string | undefined {
  const apiKeyHeader = request.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') return apiKeyHeader;

  const authHeader = request.headers.authorization;
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
}

/**
 * Accepts either a browser's short-lived OAuth access token (delegates to
 * JwtGuard, unchanged) or a personal API key (`X-Api-Key` header, or
 * `Authorization: Bearer <key>` with our brk_ prefix) — so machine callers
 * like sync/reports can authenticate without impersonating a human's
 * browser session. Distinguished by prefix rather than trying both and
 * picking whichever succeeds, so an expired/malformed JWT never gets
 * mistaken for a failed API key lookup or vice versa.
 */
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: JwtGuard,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const candidate = extractCandidate(request);

    if (candidate?.startsWith(API_KEY_PREFIX)) {
      const apiKey = await this.apiKeysService.validate(candidate);

      if (!apiKey) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }

      (request as Request & { user?: unknown }).user = { id: apiKey.userId };
      return true;
    }

    return this.jwtGuard.canActivate(context) as Promise<boolean>;
  }
}
