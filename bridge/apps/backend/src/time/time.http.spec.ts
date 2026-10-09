import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { TimeController } from './time.controller';
import { TimeService } from './time.service';

// Through a real HTTP stack with the same global ValidationPipe main.ts installs: that pipe
// (transform: true) converts a numeric query string to a number *before* the route's own
// pipes run, which a unit test of the pipe alone cannot see.
describe('Time routes over HTTP', () => {
  let app: INestApplication;
  const service = {
    findAllByUserAndYear: jest.fn().mockResolvedValue([]),
    findReportEntries: jest.fn().mockResolvedValue([]),
    deleteReportEntries: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TimeController],
      providers: [{ provide: TimeService, useValue: service }],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          context.switchToHttp().getRequest().user = { id: 1 };

          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(() => app.close());

  it('lists a year’s days off', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/time/day-offs?year=2026',
    );

    expect(response.status).toBe(200);
    expect(service.findAllByUserAndYear).toHaveBeenCalledWith(1, 2026);
  });

  it('lists a month’s report', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/time/reports?year=2026&month=10',
    );

    expect(response.status).toBe(200);
    expect(service.findReportEntries).toHaveBeenCalledWith(1, 2026, 10);
  });

  it.each([
    '/api/v1/time/day-offs?year=-5',
    '/api/v1/time/day-offs?year=99999',
    '/api/v1/time/day-offs?year=abc',
    '/api/v1/time/reports?year=2026&month=13',
    '/api/v1/time/reports?year=2026&month=0',
  ])('answers %s with a 400, not a 500', async (url) => {
    const response = await request(app.getHttpServer()).get(url);

    expect(response.status).toBe(400);
  });

  it('deletes a month’s report', async () => {
    const response = await request(app.getHttpServer()).delete(
      '/api/v1/time/reports?year=2026&month=7',
    );

    expect(response.status).toBe(204);
    expect(service.deleteReportEntries).toHaveBeenCalledWith(1, 2026, 7);
  });
});
