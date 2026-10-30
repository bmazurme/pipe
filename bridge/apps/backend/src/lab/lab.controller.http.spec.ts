import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { LabController } from './lab.controller';
import { LabProjectsService } from './lab-projects.service';
import { LabRunsService } from './lab-runs.service';
import { LabSchedulesService } from './lab-schedules.service';

// Through real HTTP and the same global ValidationPipe as main.ts (whitelist + transform): what a pipe in a unit test cannot show. The Runs tab's
// "all projects" sends no projectId at all, and that was a 400 because the global pipe made it NaN before the route's own pipe saw it.
describe('GET /api/v1/lab/runs (query handling)', () => {
  let app: INestApplication;
  const list = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LabController],
      providers: [
        { provide: LabProjectsService, useValue: {} },
        { provide: LabSchedulesService, useValue: {} },
        { provide: LabRunsService, useValue: { list } },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user?: { id: number } } };
        }) => {
          context.switchToHttp().getRequest().user = { id: 7 };

          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => list.mockReset().mockResolvedValue([]));

  it('lists the runs of every project when no project is given', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/lab/runs');

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(7, undefined, undefined);
  });

  it('filters by a project', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/lab/runs?projectId=3',
    );

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(7, undefined, 3);
  });

  it('treats an empty projectId like none, and refuses one that is not a positive whole number', async () => {
    expect(
      (await request(app.getHttpServer()).get('/api/v1/lab/runs?projectId='))
        .status,
    ).toBe(200);
    expect(list).toHaveBeenLastCalledWith(7, undefined, undefined);

    for (const bad of ['abc', '0', '-2', '1.5']) {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/lab/runs?projectId=${bad}`,
      );

      expect([bad, response.status]).toEqual([bad, 400]);
    }
  });

  it('ignores a query parameter it does not know instead of failing', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/lab/runs?other=1',
    );

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(7, undefined, undefined);
  });
});
