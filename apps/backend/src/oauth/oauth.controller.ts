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
import { Response } from 'express';

import { OauthService } from './oauth.service';

@Controller('api/v1/oauth')
@UseInterceptors(ClassSerializerInterceptor)
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
    return this.oauthService.signinOrSignup(req.user.user, response);
  }
}
