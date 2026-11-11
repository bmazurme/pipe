import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import {
  CreatedVpnProfileDto,
  CreateVpnProfileDto,
  UpdateVpnProfileDto,
  VpnProfileResponseDto,
} from './dto/vpn-profile.dto';
import { toSubscription, VpnProfilesService } from './vpn-profiles.service';

// The owner makes and revokes the tokens (browser session, owner only, like the connections they serve).
@Controller('api/v1/vpn/profiles')
@UseGuards(JwtGuard, OwnerGuard)
export class VpnProfilesController {
  constructor(private readonly profiles: VpnProfilesService) {}

  @Get()
  list(): Promise<VpnProfileResponseDto[]> {
    return this.profiles.list();
  }

  // The token comes back in this answer and never again.
  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Body() dto: CreateVpnProfileDto): Promise<CreatedVpnProfileDto> {
    return this.profiles.create(dto.label, dto.audience);
  }

  // Renames the device in the list; the link it already has keeps working.
  @Patch(':id')
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVpnProfileDto,
  ): Promise<VpnProfileResponseDto> {
    return this.profiles.rename(id, dto.label);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.profiles.revoke(id);
  }
}

// What a device's VPN client fetches. No session and no key: the token in the address is the credential, as with any subscription
// link — hence a throttle of its own, and the same 404 for an unknown and a revoked token. It carries the links of every
// connection (their servers and keys), so it is as secret as the token.
@Controller('api/v1/vpn/profile')
export class VpnProfileController {
  constructor(private readonly profiles: VpnProfilesService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async get(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const profile = await this.profiles.authenticate(token);

    if (!profile) throw new NotFoundException();

    const { links } = await this.profiles.build();

    // Hiddify / v2rayN read these: the profile's name and how often (hours) the client should fetch it again.
    response.setHeader('profile-title', 'pipe-bridge');
    response.setHeader('profile-update-interval', '1');

    return toSubscription(links);
  }
}
