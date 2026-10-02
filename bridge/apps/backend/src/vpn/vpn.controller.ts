import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { ProvisionVpnServerDto } from './dto/provision-vpn-server.dto';
import { SetClaudeOauthCredentialDto } from './dto/set-claude-oauth-credential.dto';
import { SetWorkerSecretDto } from './dto/set-worker-secret.dto';
import { ClaudeUsage, VpnService, VpnStatus } from './vpn.service';

// Browser session only — deliberately not JwtOrApiKeyGuard. This manages
// deploy-triggering GitHub credentials and worker provider keys; sync/
// reports/worker machine clients have no business calling it.
@Controller('api/v1/vpn')
@UseGuards(JwtGuard)
export class VpnController {
  constructor(private readonly vpnService: VpnService) {}

  @Get('status')
  async getStatus(): Promise<VpnStatus> {
    return this.vpnService.getStatus();
  }

  @Get('claude-usage')
  async getClaudeUsage(): Promise<ClaudeUsage> {
    return this.vpnService.getClaudeUsage();
  }

  @Get('connection-link')
  async getConnectionLink(): Promise<{ link: string }> {
    return this.vpnService.getConnectionLink();
  }

  @Post('sync')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sync(): Promise<void> {
    await this.vpnService.syncWorkerVpnConfig();
  }

  @Post('worker-secrets')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setWorkerSecret(@Body() dto: SetWorkerSecretDto): Promise<void> {
    await this.vpnService.setWorkerSecret(dto.name, dto.value);
  }

  @Post('provision')
  @HttpCode(HttpStatus.NO_CONTENT)
  async provision(@Body() dto: ProvisionVpnServerDto): Promise<void> {
    await this.vpnService.provisionServer(dto);
  }

  @Post('claude-oauth-credential')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setClaudeOauthCredential(
    @Body() dto: SetClaudeOauthCredentialDto,
  ): Promise<void> {
    await this.vpnService.setClaudeOauthCredential(dto.refreshToken);
  }
}
