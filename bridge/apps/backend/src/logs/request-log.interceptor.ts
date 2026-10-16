import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { AppLogService } from './app-log.service';

export const SLOW_REQUEST_MS = 2000;
// Identical failures (same event, method, route, status) inside this window
// are counted instead of stored; the next one after it carries `repeated`.
export const DEDUPE_WINDOW_MS = 60_000;
const MAX_DEDUPE_KEYS = 500;

// Paths that are polled constantly or are the log reader itself — recording
// them would be noise at best and a feedback loop at worst.
const IGNORED_PREFIXES = ['/api/v1/health', '/api/v1/logs'];

export interface RequestOutcome {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

// Decides whether a finished request is worth a log row: every 5xx, and any
// request slower than SLOW_REQUEST_MS. 4xx are the client's doing and stay out.
export function classifyRequest(
  outcome: RequestOutcome,
): { level: 'warn' | 'error'; event: 'http.error' | 'http.slow' } | null {
  if (outcome.method === 'OPTIONS') return null;
  if (IGNORED_PREFIXES.some((prefix) => outcome.route.startsWith(prefix))) {
    return null;
  }
  if (outcome.status >= 500) return { level: 'error', event: 'http.error' };
  if (outcome.durationMs >= SLOW_REQUEST_MS) {
    return { level: 'warn', event: 'http.slow' };
  }

  return null;
}

// The route TEMPLATE ("/api/v1/worker/jobs/:id"), never the concrete URL with
// ids or a query string.
function routeOf(request: Request): string {
  const template = (request.route as { path?: string } | undefined)?.path;

  return template ?? request.path.replace(/\d+/g, ':n');
}

@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  private readonly windows = new Map<
    string,
    { firstAt: number; suppressed: number }
  >();

  constructor(private readonly logs: AppLogService) {}

  // Returns null when the request is a repeat inside the window (suppressed),
  // otherwise the number of repeats suppressed in the window that just ended.
  private takeRepeated(key: string): number | null {
    const now = Date.now();
    const current = this.windows.get(key);

    if (current && now - current.firstAt < DEDUPE_WINDOW_MS) {
      current.suppressed += 1;

      return null;
    }

    this.windows.delete(key);
    if (this.windows.size >= MAX_DEDUPE_KEYS) {
      for (const [k, v] of this.windows) {
        if (now - v.firstAt >= DEDUPE_WINDOW_MS) this.windows.delete(k);
      }
      while (this.windows.size >= MAX_DEDUPE_KEYS) {
        const oldest = this.windows.keys().next().value as string;

        this.windows.delete(oldest);
      }
    }
    this.windows.set(key, { firstAt: now, suppressed: 0 });

    return current?.suppressed ?? 0;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const started = Date.now();

    const record = (status: number) => {
      const outcome: RequestOutcome = {
        method: request.method,
        route: routeOf(request),
        status,
        durationMs: Date.now() - started,
      };
      const verdict = classifyRequest(outcome);

      if (verdict) {
        const repeated = this.takeRepeated(
          [verdict.event, outcome.method, outcome.route, outcome.status].join(
            '|',
          ),
        );

        if (repeated === null) return;

        void this.logs.record({
          level: verdict.level,
          source: 'http',
          event: verdict.event,
          message: `${outcome.method} ${outcome.route} → ${outcome.status} in ${outcome.durationMs}ms`,
          meta: { ...outcome, ...(repeated > 0 ? { repeated } : {}) },
        });
      }
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode),
        error: (error: unknown) =>
          record(error instanceof HttpException ? error.getStatus() : 500),
      }),
    );
  }
}
