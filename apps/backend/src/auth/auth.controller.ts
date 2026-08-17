import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request as CustomRequest, Response } from 'express';

import { AuthService } from './auth.service';
import { RefreshTokenGuard } from './guards/refresh-token.guard';

type AuthRequest = CustomRequest & { cookies?: { refreshToken?: string } };

@Controller('api/v1/auth')
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(RefreshTokenGuard)
  @Get('check')
  checkAuth(
    @Request() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.checkAuth(request, response);
  }

  @UseGuards(RefreshTokenGuard)
  @Post('refresh')
  refreshToken(
    @Request() req: AuthRequest,
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
    @Request() req: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(req, response);
  }
}
