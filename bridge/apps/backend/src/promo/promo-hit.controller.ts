import type { Request } from 'express';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { PromoHitsService } from './promo-hits.service';

// The one open route of the promo module: the landing page reports a visit here (Caddy passes /_s/hit of the landing host on to it, so
// the page and this route share an origin). It stores a pseudonymous event and always answers the same, whatever it did with the
// body: a script on a public page must not be able to learn anything from the reply, and a failed report must never be visible.
@Controller('api/v1/promo')
export class PromoHitController {
  private readonly logger = new Logger(PromoHitController.name);

  constructor(private readonly hits: PromoHitsService) {}

  @Post('hit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async hit(
    @Body() body: unknown,
    @Req() req: Request,
    @Headers('origin') origin?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    try {
      await this.hits.record(body, {
        ip: req.ip ?? '',
        userAgent,
        origin,
      });
    } catch (error) {
      this.logger.warn(
        `Landing hit not stored: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
