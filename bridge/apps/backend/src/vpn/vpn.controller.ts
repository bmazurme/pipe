import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { ConfirmActionDto } from './dto/confirm-action.dto';
import { ProvisionVpnServerDto } from './dto/provision-vpn-server.dto';
import { SetWorkerSecretDto } from './dto/set-worker-secret.dto';
import { VpnService, VpnStatus } from './vpn.service';

// Browser session only — deliberately not JwtOrApiKeyGuard. This manages
// deploy-triggering GitHub credentials and worker provider keys; sync/
// reports/worker machine clients have no business calling it.
//
// sync/setWorkerSecret/provision all touch BRIDGE_GITHUB_TOKEN (push to
// Actions secrets, dispatch a workflow) — a backend compromise hands that
// token over regardless of anything checked here (see
// IMPROVEMENTS_TECH.md 1.4; the actual fix is moving these out of bridge's
// backend, not done in this pass). What's here instead: a required
// `confirm: true` body field (no accidental/replayed trigger), a much
// stricter per-route throttle than the app default (10/min, applied only to
// the three mutation routes below — not the polled, read-only GET status,
// which uses the global default), and an audit log line naming who called
// what and when.
@Controller('api/v1/vpn')
@UseGuards(JwtGuard)
export class VpnController {
  private readonly logger = new Logger(VpnController.name);

  constructor(private readonly vpnService: VpnService) {}

  @Get('status')
  async getStatus(): Promise<VpnStatus> {
    return this.vpnService.getStatus();
  }

  @Post('sync')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async sync(
    @Body() _dto: ConfirmActionDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    this.logger.warn(
      `VPN config sync + worker redeploy triggered by user ${currentUser.id}`,
    );
    await this.vpnService.syncWorkerVpnConfig();
  }

  @Post('worker-secrets')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async setWorkerSecret(
    @Body() dto: SetWorkerSecretDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    this.logger.warn(
      `Worker secret "${dto.name}" set + redeploy triggered by user ${currentUser.id}`,
    );
    await this.vpnService.setWorkerSecret(dto.name, dto.value);
  }

  @Post('provision')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async provision(
    @Body() dto: ProvisionVpnServerDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    this.logger.warn(
      `VPN server provisioning on ${dto.host} triggered by user ${currentUser.id}`,
    );
    await this.vpnService.provisionServer(dto);
  }
}
