import {
  CallHandler,
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';

import { AppLogService } from './app-log.service';
import {
  classifyRequest,
  DEDUPE_WINDOW_MS,
  RequestLogInterceptor,
  SLOW_REQUEST_MS,
} from './request-log.interceptor';

const base = {
  method: 'GET',
  route: '/api/v1/worker/jobs/:id',
  status: 200,
  durationMs: 50,
};

describe('classifyRequest', () => {
  it('ignores ordinary fast requests', () => {
    expect(classifyRequest(base)).toBeNull();
  });

  it('records every 5xx as an error', () => {
    expect(classifyRequest({ ...base, status: 500 })).toEqual({
      level: 'error',
      event: 'http.error',
    });
    expect(classifyRequest({ ...base, status: 503 })).toEqual({
      level: 'error',
      event: 'http.error',
    });
  });

  it('records slow requests as warnings', () => {
    expect(classifyRequest({ ...base, durationMs: SLOW_REQUEST_MS })).toEqual({
      level: 'warn',
      event: 'http.slow',
    });
    expect(
      classifyRequest({ ...base, durationMs: SLOW_REQUEST_MS - 1 }),
    ).toBeNull();
  });

  it('does not record client errors', () => {
    expect(classifyRequest({ ...base, status: 401 })).toBeNull();
    expect(
      classifyRequest({ ...base, status: 404, durationMs: 10 }),
    ).toBeNull();
  });

  it('skips preflight, health and the log reader itself', () => {
    expect(
      classifyRequest({ ...base, method: 'OPTIONS', status: 500 }),
    ).toBeNull();
    expect(
      classifyRequest({ ...base, route: '/api/v1/health', status: 500 }),
    ).toBeNull();
    expect(
      classifyRequest({
        ...base,
        route: '/api/v1/logs/export',
        durationMs: 9000,
      }),
    ).toBeNull();
  });
});

describe('RequestLogInterceptor.intercept', () => {
  const setup = (
    request: Record<string, unknown> = {},
    type: string = 'http',
  ) => {
    const record = jest.fn();
    const interceptor = new RequestLogInterceptor({
      record,
    } as unknown as AppLogService);
    const context = {
      getType: () => type,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          path: '/api/v1/worker/jobs/12',
          route: { path: '/api/v1/worker/jobs/:id' },
          ...request,
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;

    const run = (handler: CallHandler) =>
      lastValueFrom(interceptor.intercept(context, handler)).catch(
        () => undefined,
      );

    return { record, run };
  };
  const failing = (error: unknown): CallHandler => ({
    handle: () => throwError(() => error),
  });

  it('records an HttpException with its own status as an error', async () => {
    const { record, run } = setup();

    await run(failing(new ServiceUnavailableException()));

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('→ 503'),
      }),
    );
  });

  it('records a non-HttpException error as 500', async () => {
    const { record, run } = setup();

    await run(failing(new Error('boom')));

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('→ 500'),
      }),
    );
  });

  it('does not record a 401', async () => {
    const { record, run } = setup();

    await run(failing(new UnauthorizedException()));

    expect(record).not.toHaveBeenCalled();
  });

  it('passes non-http contexts straight through', async () => {
    const { record, run } = setup({}, 'rpc');

    await run(failing(new Error('boom')));

    expect(record).not.toHaveBeenCalled();
  });

  it('falls back to a digit-masked path when request.route is absent', async () => {
    const { record, run } = setup({ route: undefined });

    await run(failing(new Error('boom')));

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('/api/v:n/worker/jobs/:n'),
      }),
    );
  });

  it('does not record a fast successful request', async () => {
    const { record, run } = setup();

    await run({ handle: () => of('ok') });

    expect(record).not.toHaveBeenCalled();
  });
});

describe('RequestLogInterceptor repeat suppression', () => {
  const build = () => {
    const record = jest.fn();
    const interceptor = new RequestLogInterceptor({
      record,
    } as unknown as AppLogService);
    const run = (path: string, error: unknown = new Error('boom')) =>
      lastValueFrom(
        interceptor.intercept(
          {
            getType: () => 'http',
            switchToHttp: () => ({
              getRequest: () => ({ method: 'POST', path, route: { path } }),
              getResponse: () => ({ statusCode: 200 }),
            }),
          } as unknown as ExecutionContext,
          { handle: () => throwError(() => error) },
        ),
      ).catch(() => undefined);

    return { record, run };
  };

  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-01-01')));
  afterEach(() => jest.useRealTimers());

  it('does not record a second identical failure inside the window', async () => {
    const { record, run } = build();

    for (let i = 0; i < 100; i += 1) await run('/hook');

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].meta.repeated).toBeUndefined();
  });

  it('records one row carrying repeated after the window', async () => {
    const { record, run } = build();

    for (let i = 0; i < 100; i += 1) await run('/hook');
    jest.setSystemTime(Date.now() + DEDUPE_WINDOW_MS + 1);
    await run('/hook');

    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1][0].meta.repeated).toBe(99);
  });

  it('keeps different routes and statuses independent', async () => {
    const { record, run } = build();

    await run('/a');
    await run('/b');
    await run('/a', new ServiceUnavailableException());

    expect(record).toHaveBeenCalledTimes(3);
  });
});
