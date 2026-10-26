import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MachineOnly } from '../auth/decorators/machine-only.decorator';
import { WorkerKeyAllowed } from '../auth/decorators/worker-key-allowed.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import {
  CreateWorkerDto,
  CreatedWorkerResponseDto,
  DeletedWorkerResponseDto,
  EnrollWorkerDto,
  EnrolledWorkerResponseDto,
  UpdateWorkerDto,
  WorkerConfigResponseDto,
  WorkerResponseDto,
} from './dto/worker-fleet.dto';
import { limitProbeWanted } from './limit-probe';
import { RunCredentialsService } from './run-credentials.service';
import { WorkersService } from './workers.service';

// The workers the owner manages from the Worker page (browser session only), plus the two calls a worker makes about
// itself: redeeming its one-time enrollment code (public — the code is the credential, and the route is throttled) and
// fetching its settings (its own key).
@Controller('api/v1/workers')
export class WorkersController {
  constructor(
    private readonly workersService: WorkersService,
    private readonly runCredentials: RunCredentialsService,
  ) {}

  @Get()
  @UseGuards(JwtGuard)
  list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<WorkerResponseDto[]> {
    return this.workersService.list(currentUser.id);
  }

  @Post()
  @UseGuards(JwtGuard)
  create(
    @Body() dto: CreateWorkerDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<CreatedWorkerResponseDto> {
    return this.workersService.create(currentUser.id, dto);
  }

  // Public: a worker with no key yet cannot authenticate. 10 tries a minute per address on top of a 144-bit code that
  // is single-use and expires in 30 minutes.
  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  enroll(@Body() dto: EnrollWorkerDto): Promise<EnrolledWorkerResponseDto> {
    return this.workersService.enroll(dto);
  }

  // Declared before ':id' so "me" is never read as an id.
  @Get('me/config')
  @MachineOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @WorkerKeyAllowed()
  async config(
    @CurrentUser() currentUser: { id: number; workerId?: number },
  ): Promise<WorkerConfigResponseDto> {
    const config = await this.workersService.configForPrincipal(currentUser);

    // The token to probe the plan limits with goes to the worker only while a probe is due, and is the one its jobs use.
    if (limitProbeWanted(config)) {
      const { claudeToken } = await this.runCredentials.resolve(
        currentUser.id,
        currentUser.workerId,
        'sonnet',
      );

      config.limitProbe = claudeToken ? { claudeToken } : null;
    }

    return config;
  }

  @Delete('legacy/:name')
  @UseGuards(JwtGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgetLegacy(
    @Param('name') name: string,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.workersService.forgetLegacy(currentUser.id, name);
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkerDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<WorkerResponseDto> {
    return this.workersService.update(id, currentUser.id, dto);
  }

  // A new one-time code: connects a worker that has not enrolled yet, or reconnects one (its old key is revoked).
  @Post(':id/enroll-code')
  @UseGuards(JwtGuard)
  renewEnrollment(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<CreatedWorkerResponseDto> {
    return this.workersService.renewEnrollment(id, currentUser.id);
  }

  // "Refresh limits" on a worker's card: the worker probes the plan limits once and reports them.
  @Post(':id/refresh-limits')
  @UseGuards(JwtGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async refreshLimits(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.workersService.requestLimitsRefresh(id, currentUser.id);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<DeletedWorkerResponseDto> {
    return this.workersService.remove(id, currentUser.id);
  }
}
