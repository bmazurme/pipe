import {
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtGuard } from './guards/jwt.guard';
import {
  RefreshTokenGuard,
  RequestWithAuthSession,
} from './guards/refresh-token.guard';

@Controller('api/v1/auth')
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
