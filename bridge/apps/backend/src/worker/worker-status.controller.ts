import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { WorkerStatusResponseDto } from './dto/worker-status-response.dto';
import { WorkersService } from './workers.service';

// Browser-only in practice (the Worker page's status block) — the worker
// process itself never calls this, it only ever gets recorded as a side
// effect of its own claim call (see WorkerService.claim).
@Controller('api/v1/worker/status')
@UseGuards(JwtOrApiKeyGuard)
export class WorkerStatusController {
  constructor(private readonly workersService: WorkersService) {}

  @Get()
  async getStatus(
    @CurrentUser() currentUser: { id: number },
  ): Promise<WorkerStatusResponseDto> {
    // Workers added in the UI and the ones still on a personal API key, together: "is anything able to take work".
    const workers = await this.workersService.list(currentUser.id);
    const heartbeats = workers.flatMap((worker) =>
      worker.lastSeenAt
        ? [
            {
              name: worker.name,
              lastSeenAt: worker.lastSeenAt,
              isUp: worker.state === 'idle' || worker.state === 'busy',
            },
          ]
        : [],
    );

    return WorkerStatusResponseDto.fromHeartbeats(heartbeats);
  }
}
