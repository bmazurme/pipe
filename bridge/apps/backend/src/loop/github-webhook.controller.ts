import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  RawBodyRequest,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';

import { LoopService } from './loop.service';
import { isValidGithubSignature } from './webhook-signature';

// Authenticated by GitHub's HMAC signature over the raw body, not by a
// session or API key — GitHub can send neither. Hidden from OpenAPI: it is
// not part of the contract any client of this API codes against.
@ApiExcludeController()
@Controller('api/v1/github')
export class GithubWebhookController {
  constructor(
    private readonly loopService: LoopService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: unknown,
  ): Promise<{ handled: boolean }> {
    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');

    if (!secret) {
      throw new ServiceUnavailableException(
        'GITHUB_WEBHOOK_SECRET is not configured',
      );
    }

    if (
      !request.rawBody ||
      !isValidGithubSignature(secret, request.rawBody, signature)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (event === 'ping') {
      return { handled: true };
    }

    return {
      handled: await this.loopService.handleGithubEvent(event ?? '', payload),
    };
  }
}
