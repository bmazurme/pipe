import { Module } from '@nestjs/common';

import { SecretsModule } from '../secrets/secrets.module';
import { ChannelFactsService } from './channel-facts.service';

// One place that talks to YouTube and Instagram for everything in bridge that needs them: Lab hands a run what the channels show now;
// /promo (its statistics and the later auto-publishing, PROMO-MODULE-PLAN stage 5) takes the same reader and the same credentials.
@Module({
  imports: [SecretsModule],
  providers: [ChannelFactsService],
  exports: [ChannelFactsService],
})
export class ChannelsModule {}
