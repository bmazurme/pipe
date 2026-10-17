import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MAX_REPLY_LENGTH } from '../chat/chat.limits';
import { CompleteTurnDto } from '../chat/dto/complete-turn.dto';
import { configureBodyParsers } from './body-parser.config';

// Same DTO and pipe as ChatController's complete route, without its auth and database.
@Controller('chat')
class CompleteTurnStubController {
  @Post('turns/:messageId/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Body() dto: CompleteTurnDto): { length: number } {
    return { length: dto.content.length };
  }
}

describe('configureBodyParsers', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompleteTurnStubController],
    }).compile();

    // Same options and order as main.ts.
    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureBodyParsers(app);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a chat reply far above the old 100 kb default', async () => {
    const content = 'ж'.repeat(150_000); // ~300 KB of JSON

    const response = await request(app.getHttpServer())
      .post('/chat/turns/1/complete')
      .send({ content })
      .expect(200);

    expect(response.body).toEqual({ length: content.length });
  });

  it('rejects a body above the limit with 413', async () => {
    await request(app.getHttpServer())
      .post('/chat/turns/1/complete')
      .send({ content: 'x'.repeat(3 * 1024 * 1024) })
      .expect(413);
  });

  it('rejects a reply longer than MAX_REPLY_LENGTH with 400', async () => {
    await request(app.getHttpServer())
      .post('/chat/turns/1/complete')
      .send({ content: 'x'.repeat(MAX_REPLY_LENGTH + 1) })
      .expect(400);
  });
});
