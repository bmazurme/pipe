import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';

import { OauthService } from './oauth.service';

// Human-initiated login, never polled — same reasoning as AuthController's
// own stricter throttle.
@Controller('api/v1/oauth')
@UseInterceptors(ClassSerializerInterceptor)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class OauthController {
  constructor(private readonly oauthService: OauthService) {}

  @Get('yandex')
  @UseGuards(AuthGuard('yandex'))
  async yandexLogin(): Promise<void> {
    // handled by passport-yandex, redirects to Yandex's consent screen
  }

  @Get('yandex/redirect')
  @UseGuards(AuthGuard('yandex'))
  async yandexLoginRedirect(
    @Req() req: Request & { user: { user: { email: string } } },
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const userAgent = req.headers['user-agent'] ?? null;

    return this.oauthService.signinOrSignup(
      req.user.user,
      response,
      userAgent,
      req.ip ?? null,
    );
  }
}
