import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ReportsSettingsBackupResponseDto } from './dto/reports-settings-backup-response.dto';
import { UpsertReportsSettingsBackupDto } from './dto/upsert-reports-settings-backup.dto';
import { ReportsSettingsService } from './reports-settings.service';

// Hit by both reports (a personal API key, pushing/pulling its own settings
// bundle) and bridge's own browser page (a JWT, showing/deleting the saved
// backup) — same guard choice as TimeImportController for the same reason.
@Controller('api/v1/reports-settings')
@UseGuards(JwtOrApiKeyGuard)
export class ReportsSettingsController {
  constructor(
    private readonly reportsSettingsService: ReportsSettingsService,
  ) {}

  // Status only, no payload — same "don't return the secret in a listing"
  // reasoning as SecretsController.list()/reveal(). Used by bridge's page.
  @Get()
  async status(
    @CurrentUser() currentUser: { id: number },
  ): Promise<ReportsSettingsBackupResponseDto | null> {
    const backup = await this.reportsSettingsService.findForUser(
      currentUser.id,
    );

    return backup ? ReportsSettingsBackupResponseDto.fromEntity(backup) : null;
  }

  // The raw bundle — one explicit action (reports' own "Import from Bridge"),
  // not something returned by the general status check above.
  @Get('payload')
  async payload(
    @CurrentUser() currentUser: { id: number },
  ): Promise<{ updatedAt: Date; payload: string }> {
    const backup = await this.reportsSettingsService.getForUser(currentUser.id);

    return { updatedAt: backup.updatedAt, payload: backup.payload };
  }

  @Put()
  async upsert(
    @Body() dto: UpsertReportsSettingsBackupDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ReportsSettingsBackupResponseDto> {
    const backup = await this.reportsSettingsService.upsertForUser(
      currentUser.id,
      dto.payload,
    );

    return ReportsSettingsBackupResponseDto.fromEntity(backup);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() currentUser: { id: number }): Promise<void> {
    await this.reportsSettingsService.deleteForUser(currentUser.id);
  }
}
