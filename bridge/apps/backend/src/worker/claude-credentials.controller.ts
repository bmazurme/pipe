import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { UpdateClaudeCredentialDto } from './dto/update-claude-credential.dto';

// Writes (create, replace, remove) need a browser session: a personal API key lives on
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
    const [credentials, usage] = await Promise.all([
      this.claudeCredentialsService.findAllByUser(currentUser.id),
      this.claudeCredentialsService.recentUsage(
        currentUser.id,
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      ),
    ]);

    return credentials.map((credential) => ({
      ...ClaudeCredentialResponseDto.fromEntity(credential),
      usage7d: usage.get(credential.id) ?? null,
    }));
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

  @Patch(':id')
  @UseGuards(JwtGuard)
  async replaceToken(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClaudeCredentialDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ClaudeCredentialResponseDto> {
    const credential = await this.claudeCredentialsService.replaceToken(
      id,
      currentUser.id,
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
