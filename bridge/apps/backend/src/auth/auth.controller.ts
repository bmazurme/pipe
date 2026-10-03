import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { ApiKeysService } from './api-keys.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { ApiKeyResponseDto } from './dto/api-key-response.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CreatedApiKeyResponseDto } from './dto/created-api-key.response.dto';
import { JwtGuard } from './guards/jwt.guard';
import {
  RefreshTokenGuard,
  RequestWithAuthSession,
} from './guards/refresh-token.guard';

// None of these routes are polled — every one is a human clicking something
// (or a refresh-token rotation the frontend fires on a 401) — so a much
// tighter limit than the app-wide default is safe here and bounds exactly
// the thing the P0 rate-limiting gap called out: guessing/brute-forcing a
// refresh token or hammering API-key creation.
@Controller('api/v1/auth')
@UseInterceptors(ClassSerializerInterceptor)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  @UseGuards(RefreshTokenGuard)
  @Get('check')
  checkAuth(
    @Request() request: RequestWithAuthSession,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.checkAuth(request, response);
  }

  @UseGuards(RefreshTokenGuard)
  @Post('refresh')
  refreshToken(
    @Request() req: RequestWithAuthSession,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.refreshTokens(req, response);
  }

  @UseGuards(RefreshTokenGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'User successfully logged out' })
  logout(
    @Request() req: RequestWithAuthSession,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(req, response);
  }

  @UseGuards(JwtGuard)
  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions (devices) for current user' })
  listSessions(@CurrentUser() currentUser: { id: number; sessionId: number }) {
    return this.authService.listSessions(currentUser.id, currentUser.sessionId);
  }

  @UseGuards(JwtGuard)
  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Revoke a session (remotely sign out a device)' })
  revokeSession(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number; sessionId: number },
  ) {
    return this.authService.revokeSession(
      currentUser.id,
      id,
      currentUser.sessionId,
    );
  }

  @UseGuards(JwtGuard)
  @Post('api-keys')
  @ApiOperation({
    summary:
      'Create a personal API key (for machine callers like sync-cli, that cannot go through OAuth)',
  })
  async createApiKey(
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() currentUser: { id: number },
  ) {
    const created = await this.apiKeysService.create(currentUser.id, dto.name);
    return CreatedApiKeyResponseDto.fromCreatedApiKey(created);
  }

  @UseGuards(JwtGuard)
  @Get('api-keys')
  @ApiOperation({ summary: 'List active API keys for current user' })
  async listApiKeys(@CurrentUser() currentUser: { id: number }) {
    const apiKeys = await this.apiKeysService.findActiveByUser(currentUser.id);
    return apiKeys.map(ApiKeyResponseDto.fromEntity);
  }

  @UseGuards(JwtGuard)
  @Delete('api-keys/:id')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revokeApiKey(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ) {
    const revoked = await this.apiKeysService.revoke(id, currentUser.id);

    if (!revoked) {
      throw new NotFoundException('API key not found');
    }

    return { message: 'API key revoked' };
  }
}
