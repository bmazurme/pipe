import './pg-timestamp-parser';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { configureCors } from './config/cors.config';
import { swaggerConfig } from './config/swagger.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    // GitHub's webhook signature is an HMAC over the exact bytes it sent —
    // GithubWebhookController can't verify it from the re-serialized JSON body.
    rawBody: true,
  });

  // Production always sits behind a reverse proxy on the same host (see
  // deploy-bridge.yml's smoke-test comment: "proxy_pass must use 127.0.0.1,
  // not localhost") — without this, Express's req.ip is always the proxy's
  // own loopback address for every request, so ThrottlerGuard's per-IP
  // tracking would lump every real client into one shared bucket. 'loopback'
  // trusts X-Forwarded-For only from that one known hop, not from an
  // arbitrary client claiming any IP it likes.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');

  const configService = app.get(ConfigService);

  app.use(cookieParser());
  app.use(compression());
  app.use(helmet());

  configureCors(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  if (configService.get<string>('NODE_ENV') !== 'production') {
    const documentFactory = () =>
      SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api', app, documentFactory);
  }

  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port);
  logger.log(`Application is running on port ${port}`);
}
bootstrap();
