import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const configureCors = (app: INestApplication) => {
  const configService = app.get(ConfigService);
  const raw = configService.get<string>('CORS_ORIGINS') ?? '';
  const origin = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origin.length ? origin : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // X-Step-Up carries the five-minute second-factor grant (auth/step-up); without it the browser's preflight
    // refuses every confirmed request when the frontend is on another origin.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Step-Up',
    ],
    exposedHeaders: ['X-Issues-Stale-Since'],
    credentials: true,
    maxAge: 3600,
    optionsSuccessStatus: 204,
  });
};
