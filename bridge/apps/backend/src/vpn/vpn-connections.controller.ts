import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { CreateVpnConnectionDto } from './dto/create-vpn-connection.dto';
import { UpdateVpnConnectionDto } from './dto/update-vpn-connection.dto';
import { VpnConnectionResponseDto } from './dto/vpn-connection-response.dto';
import { subscriptionName } from './subscription';
import { SubscriptionService } from './subscription.service';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnService, VpnStatus } from './vpn.service';

// Browser session, deployment owner only, same as VpnController.
@Controller('api/v1/vpn/connections')
@UseGuards(JwtGuard, OwnerGuard)
export class VpnConnectionsController {
  constructor(
    private readonly vpnConnectionsService: VpnConnectionsService,
    private readonly vpnService: VpnService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Get()
  async list(): Promise<VpnConnectionResponseDto[]> {
    const connections = await this.vpnConnectionsService.findAll();
    return connections.map(VpnConnectionResponseDto.fromEntity);
  }

  @Post()
  async create(
    @Body() dto: CreateVpnConnectionDto,
  ): Promise<VpnConnectionResponseDto> {
    if (dto.subscriptionUrl) {
      if (dto.panelUrl || dto.panelApiToken || dto.serverAddress) {
        throw new BadRequestException(
          'Укажите либо ссылку подписки, либо данные панели — не то и другое сразу',
        );
      }

      // Fetched now, so a wrong link is refused here with the reason instead of saved and failing later.
      const { host } = await this.subscriptions.resolve(
        dto.subscriptionUrl,
        dto.name,
      );
      const connection =
        await this.vpnConnectionsService.createFromSubscription(
          dto.name.trim() || subscriptionName(dto.subscriptionUrl) || host,
          dto.subscriptionUrl,
          host,
        );

      return VpnConnectionResponseDto.fromEntity(connection);
    }

    const connection = await this.vpnConnectionsService.create(
      dto.name,
      dto.panelUrl as string,
      dto.panelApiToken as string,
      dto.serverAddress as string,
    );

    return VpnConnectionResponseDto.fromEntity(connection);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVpnConnectionDto,
  ): Promise<VpnConnectionResponseDto> {
    const changes = { ...dto };

    if (dto.subscriptionUrl !== undefined) {
      // A new link is checked like a new connection, and the server follows it.
      const { host } = await this.subscriptions.resolve(
        dto.subscriptionUrl,
        dto.name ?? 'подписка',
      );

      changes.serverAddress = host;
    } else if (
      (await this.vpnConnectionsService.findOne(id)).kind === 'subscription'
    ) {
      // The server of a subscription is whatever its link says: it is not edited by hand.
      delete changes.serverAddress;
    }

    const connection = await this.vpnConnectionsService.update(id, changes);
    return VpnConnectionResponseDto.fromEntity(connection);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.vpnConnectionsService.remove(id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async activate(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.vpnConnectionsService.activate(id);
  }

  // Checks this one specific connection, active or not. `force=1` (the
  // "Проверить" button) always hits the panel fresh; anyone polling this
  // route periodically (the Dashboard, one connection at a time) leaves it
  // off and gets the same short-lived cache /vpn/status already uses for
  // the active connection — otherwise a dashboard tile would hit every
  // stored VPN panel on every poll.
  @Get(':id/status')
  async getStatus(
    @Param('id', ParseIntPipe) id: number,
    @Query('force') force?: string,
  ): Promise<VpnStatus> {
    return this.vpnService.checkConnectionStatus(id, force === '1');
  }

  @Get(':id/connection-link')
  @Header('Cache-Control', 'no-store')
  async getConnectionLink(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ link: string }> {
    return this.vpnService.getConnectionLink(id);
  }
}
