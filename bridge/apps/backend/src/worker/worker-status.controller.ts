import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { WorkerStatusResponseDto } from './dto/worker-status-response.dto';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

// Browser-only in practice (the Worker page's status block) — the worker
// process itself never calls this, it only ever gets recorded as a side
// effect of its own claim call (see WorkerService.claim).
@Controller('api/v1/worker/status')
@UseGuards(JwtOrApiKeyGuard)
export class WorkerStatusController {
  constructor(private readonly heartbeatService: WorkerHeartbeatService) {}

  @Get()
  async getStatus(
    @CurrentUser() currentUser: { id: number },
  ): Promise<WorkerStatusResponseDto> {
    const heartbeats = await this.heartbeatService.listForUser(currentUser.id);

    return WorkerStatusResponseDto.fromHeartbeats(heartbeats);
  }
}
