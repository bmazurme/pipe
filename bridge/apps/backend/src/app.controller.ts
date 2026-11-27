import { Controller, Get, HttpStatus, Optional, Res } from '@nestjs/common';
import { Response } from 'express';

import { AppService } from './app.service';
import { ExternalHeartbeatService } from './external-heartbeat/external-heartbeat.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Optional() private readonly heartbeat?: ExternalHeartbeatService,
  ) {}

  @Get()
  getHealth(): string {
    return this.appService.getHealth();
  }

  // Readiness, not just liveness — see AppService.getHealthStatus. A 503
  // here is what a Swarm healthcheck (and a manual curl) can actually act
  // on; a 200 from the plain GET / above says nothing about Postgres.
  @Get('api/v1/health')
  async getHealthStatus(@Res({ passthrough: true }) res: Response) {
    const health = await this.appService.getHealthStatus();

    res.status(
      health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    // R9: whether the dead man's hand (the heartbeat to the external watcher) is set up and getting through — only a yes/no and times, never the address.
    return this.heartbeat
      ? { ...health, externalHeartbeat: this.heartbeat.status() }
      : health;
  }
}
