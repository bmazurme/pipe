import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { ClaudeCredentialResponseDto } from './dto/claude-credential-response.dto';
import { CreateClaudeCredentialDto } from './dto/create-claude-credential.dto';

// Writes (create, remove) need a browser session: a personal API key lives on
// disk in sync's and reports' config and must not be able to plant or wipe the
// account's Claude tokens. harness (--live) reads the list with an API key, so
// only that route accepts one.
@Controller('api/v1/worker/claude-credentials')
export class ClaudeCredentialsController {
  constructor(
    private readonly claudeCredentialsService: ClaudeCredentialsService,
  ) {}

  @Get()
  @UseGuards(JwtOrApiKeyGuard)
  async list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<ClaudeCredentialResponseDto[]> {
    const credentials = await this.claudeCredentialsService.findAllByUser(
      currentUser.id,
    );

    return credentials.map(ClaudeCredentialResponseDto.fromEntity);
  }

  @Post()
  @UseGuards(JwtGuard)
  async create(
    @Body() dto: CreateClaudeCredentialDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ClaudeCredentialResponseDto> {
    const credential = await this.claudeCredentialsService.create(
      currentUser.id,
      dto.name,
      dto.token,
    );

    return ClaudeCredentialResponseDto.fromEntity(credential);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.claudeCredentialsService.remove(id, currentUser.id);
  }
}
