import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { API_KEY_PREFIX, ApiKeysService } from '../api-keys.service';
import { BOARD_AGENT_KEY_ALLOWED } from '../decorators/board-agent-key-allowed.decorator';
import { MACHINE_ONLY } from '../decorators/machine-only.decorator';
import { WORKER_KEY_ALLOWED } from '../decorators/worker-key-allowed.decorator';
import { WORKER_KEY_PREFIX, WorkerKeysService } from '../worker-keys.service';
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
    private readonly workerKeysService: WorkerKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const candidate = extractCandidate(request);

    // A worker's own key: valid only on the routes marked WorkerKeyAllowed, and it carries which worker is calling.
    if (candidate?.startsWith(WORKER_KEY_PREFIX)) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        WORKER_KEY_ALLOWED,
        [context.getHandler(), context.getClass()],
      );

      if (!allowed) {
        throw new ForbiddenException('A worker key cannot call this route');
      }

      const principal = await this.workerKeysService.validate(candidate);

      if (!principal) {
        throw new UnauthorizedException('Invalid or revoked worker key');
      }

      (request as Request & { user?: unknown }).user = {
        id: principal.userId,
        workerId: principal.workerId,
      };
      return true;
    }

    if (candidate?.startsWith(API_KEY_PREFIX)) {
      const apiKey = await this.apiKeysService.validate(candidate);

      if (!apiKey) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }

      if (apiKey.scope === 'boards') {
        const allowed = this.reflector.getAllAndOverride<boolean>(
          BOARD_AGENT_KEY_ALLOWED,
          [context.getHandler(), context.getClass()],
        );

        if (!allowed) {
          throw new ForbiddenException(
            'A boards-only key cannot call this route',
          );
        }
      }

      (request as Request & { user?: unknown }).user = { id: apiKey.userId };
      return true;
    }

    const machineOnly = this.reflector.getAllAndOverride<boolean>(
      MACHINE_ONLY,
      [context.getHandler(), context.getClass()],
    );

    if (machineOnly) {
      throw new ForbiddenException('This route is for workers only');
    }

    return this.jwtGuard.canActivate(context) as Promise<boolean>;
  }
}
