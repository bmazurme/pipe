import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PromoAsset } from './entities/promo-asset.entity';
import { PromoLandingHit } from './entities/promo-landing-hit.entity';
import { PromoLandingRelease } from './entities/promo-landing-release.entity';
import { PromoPost } from './entities/promo-post.entity';
import { PromoTelegramTarget } from './entities/promo-telegram-target.entity';
import { PromoAssetsService } from './promo-assets.service';
import { PromoHitController } from './promo-hit.controller';
import { PromoHitsService } from './promo-hits.service';
import { PromoLandingService } from './promo-landing.service';
import { PromoOverviewService } from './promo-overview.service';
import { PromoPostsService } from './promo-posts.service';
import { PromoPublisherService } from './promo-publisher.service';
import { PromoTelegramService } from './promo-telegram.service';
import { PromoController } from './promo.controller';

// Promotion of the project: posts for the channels (Telegram, YouTube, Instagram), the files they carry, and the landing page
// bridge itself publishes. Owner only. See PROMO-MODULE-PLAN.md.
@Module({
  imports: [
    AuthModule,
    StorageModule,
    TelegramModule,
    TypeOrmModule.forFeature([
      PromoPost,
      PromoAsset,
      PromoLandingRelease,
      PromoTelegramTarget,
      PromoLandingHit,
    ]),
  ],
  controllers: [PromoController, PromoHitController],
  providers: [
    PromoPostsService,
    PromoAssetsService,
    PromoLandingService,
    PromoHitsService,
    PromoOverviewService,
    PromoTelegramService,
    PromoPublisherService,
  ],
})
export class PromoModule {}
