import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import {
  type BridgeTunnelStatus,
  BridgeTunnelService,
} from './bridge-tunnel.service';

// What the owner sees about bridge's own tunnel: whether Telegram and GitHub go through the active VPN connection right now.
@Controller('api/v1/vpn/bridge-tunnel')
@UseGuards(JwtGuard, OwnerGuard)
export class TunnelController {
  constructor(private readonly tunnel: BridgeTunnelService) {}

  @Get()
  status(): BridgeTunnelStatus {
    return this.tunnel.status();
  }
}
