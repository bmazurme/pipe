import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VpnModule } from '../vpn/vpn.module';
import { BridgeTunnelService } from './bridge-tunnel.service';
import { TunnelController } from './tunnel.controller';

@Module({
  imports: [AuthModule, VpnModule, TelegramModule],
  controllers: [TunnelController],
  providers: [BridgeTunnelService],
})
export class TunnelModule {}
