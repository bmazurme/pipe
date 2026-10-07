import { classifyRequest, SLOW_REQUEST_MS } from './request-log.interceptor';

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
