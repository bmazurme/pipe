import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VpnConnection } from './entities/vpn-connection.entity';
import { GithubActionsService } from './github-actions.service';
import { SubscriptionService } from './subscription.service';
import { VpnProfileToken } from './entities/vpn-profile-token.entity';
import {
  VpnProfileController,
  VpnProfilesController,
} from './vpn-profiles.controller';
import { VpnProfilesService } from './vpn-profiles.service';
import { VpnConnectionsController } from './vpn-connections.controller';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnStatusAlertsService } from './vpn-status-alerts.service';
import { VpnLinkResolver } from './vpn-link-resolver.service';
import { VpnController } from './vpn.controller';
import { VpnService } from './vpn.service';

@Module({
  imports: [
    AuthModule,
    TelegramModule,
    TypeOrmModule.forFeature([VpnConnection, VpnProfileToken]),
  ],
  controllers: [
    VpnController,
    VpnConnectionsController,
    VpnProfilesController,
    VpnProfileController,
  ],
  providers: [
    VpnService,
    VpnConnectionsService,
    GithubActionsService,
    VpnStatusAlertsService,
    VpnLinkResolver,
    SubscriptionService,
    VpnProfilesService,
  ],
  exports: [VpnConnectionsService, VpnLinkResolver],
})
export class VpnModule {}
