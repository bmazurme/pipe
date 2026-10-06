import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { TelegramService } from '../telegram/telegram.service';
import { ClientHeartbeatService } from './client-heartbeat.service';
import { ClientEventDto } from './dto/client-event.dto';
import { ClientHeartbeatDto } from './dto/client-heartbeat.dto';

// What a machine client in the closed contour (reports) tells bridge about
// itself. Personal API key auth, same as sync/reports/worker use for storage.
@Controller('api/v1/clients')
@UseGuards(JwtOrApiKeyGuard)
export class ClientsController {
  constructor(
    private readonly heartbeats: ClientHeartbeatService,
    private readonly telegram: TelegramService,
  ) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  async heartbeat(
    @Body() dto: ClientHeartbeatDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.heartbeats.record(currentUser.id, dto.name, dto.kind);
  }

  @Post('events')
  @HttpCode(HttpStatus.NO_CONTENT)
  async event(@Body() dto: ClientEventDto): Promise<void> {
    const message =
      dto.type === 'pulled'
        ? `⬇️ Результат по ${dto.taskKey} загружен${dto.branch ? ` в ветку ${dto.branch}` : ''} (${dto.name})`
        : `⚠️ Не удалось загрузить результат по ${dto.taskKey} (${dto.name})${dto.error ? `: ${dto.error}` : ''}`;

    await this.telegram.send(message);
  }
}
