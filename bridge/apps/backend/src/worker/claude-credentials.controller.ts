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
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { ClaudeCredentialResponseDto } from './dto/claude-credential-response.dto';
import { CreateClaudeCredentialDto } from './dto/create-claude-credential.dto';

// Same guard as WorkerController — managed from the Worker page by a
// browser session, read by the worker process's own claim call (see
// WorkerController.claim), never anything else.
@Controller('api/v1/worker/claude-credentials')
@UseGuards(JwtOrApiKeyGuard)
export class ClaudeCredentialsController {
  constructor(
    private readonly claudeCredentialsService: ClaudeCredentialsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<ClaudeCredentialResponseDto[]> {
    const credentials = await this.claudeCredentialsService.findAllByUser(
      currentUser.id,
    );

    return credentials.map(ClaudeCredentialResponseDto.fromEntity);
  }

  @Post()
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
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.claudeCredentialsService.remove(id, currentUser.id);
  }
}
