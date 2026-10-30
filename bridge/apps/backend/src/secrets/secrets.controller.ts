import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateSecretDto } from './dto/create-secret.dto';
import { SecretResponseDto } from './dto/secret-response.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import { SecretsService } from './secrets.service';

// Browser-only (JwtGuard, no API-key fallback): a personal vault the user
// manages from the frontend, not a credential any machine client
// (sync/reports/worker) authenticates with — same guard choice as
// PurgeController for the same reason.
@Controller('api/v1/secrets')
@UseGuards(JwtGuard)
export class SecretsController {
  private readonly logger = new Logger(SecretsController.name);

  constructor(private readonly secretsService: SecretsService) {}

  @Get()
  async list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<SecretResponseDto[]> {
    const secrets = await this.secretsService.findAllByUser(currentUser.id);

    return secrets.map(SecretResponseDto.fromEntity);
  }

  // Declared before the ':id' routes. Every value leaves in one response, so
  // the audit line names only the user, never a secret.
  @Get('export')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async exportEnv(@CurrentUser() currentUser: { id: number }): Promise<string> {
    this.logger.warn(`Secrets .env export by user ${currentUser.id}`);

    return this.secretsService.exportEnv(currentUser.id);
  }

  @Post()
  async create(
    @Body() dto: CreateSecretDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<SecretResponseDto> {
    const secret = await this.secretsService.create(currentUser.id, dto);

    return SecretResponseDto.fromEntity(secret);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSecretDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<SecretResponseDto> {
    const secret = await this.secretsService.update(id, currentUser.id, dto);

    return SecretResponseDto.fromEntity(secret);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.secretsService.delete(id, currentUser.id);
  }

  // Deliberately separate from list() — reveal is one explicit user action
  // (a click, not a render), not something that happens just by loading the
  // page the vault lives on.
  @Get(':id/value')
  @Header('Cache-Control', 'no-store')
  async reveal(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<{ value: string }> {
    const value = await this.secretsService.revealValue(id, currentUser.id);

    return { value };
  }
}
