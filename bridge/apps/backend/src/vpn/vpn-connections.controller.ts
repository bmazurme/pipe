import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateVpnConnectionDto } from './dto/create-vpn-connection.dto';
import { UpdateVpnConnectionDto } from './dto/update-vpn-connection.dto';
import { VpnConnectionResponseDto } from './dto/vpn-connection-response.dto';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnService, VpnStatus } from './vpn.service';

// Browser session only, same as VpnController.
@Controller('api/v1/vpn/connections')
@UseGuards(JwtGuard)
export class VpnConnectionsController {
  constructor(
    private readonly vpnConnectionsService: VpnConnectionsService,
    private readonly vpnService: VpnService,
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
    const connection = await this.vpnConnectionsService.create(
      dto.name,
      dto.panelUrl,
      dto.panelApiToken,
      dto.serverAddress,
    );

    return VpnConnectionResponseDto.fromEntity(connection);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVpnConnectionDto,
  ): Promise<VpnConnectionResponseDto> {
    const connection = await this.vpnConnectionsService.update(id, dto);
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

  // Live-checks this one specific connection, active or not — backs the
  // "Проверить" button on each row of the list, independent of the
  // auto-polling top status card (which only ever reflects the active one).
  @Get(':id/status')
  async getStatus(@Param('id', ParseIntPipe) id: number): Promise<VpnStatus> {
    return this.vpnService.checkConnectionStatus(id);
  }

  @Get(':id/connection-link')
  async getConnectionLink(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ link: string }> {
    return this.vpnService.getConnectionLink(id);
  }
}
