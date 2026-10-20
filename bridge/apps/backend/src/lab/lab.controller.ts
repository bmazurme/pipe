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
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import {
  CreateLabProjectDto,
  SaveLabScheduleDto,
  StartLabRunDto,
  UpdateLabProjectDto,
} from './dto/lab.dto';
import { LabProjectsService } from './lab-projects.service';
import { LabRunsService } from './lab-runs.service';
import { LabSchedulesService } from './lab-schedules.service';

// Browser session only: this starts paid worker runs and writes to the owner's GitHub with their token, so a machine API key does not
// reach it. Every row is the caller's own.
@Controller('api/v1/lab')
@UseGuards(JwtGuard)
export class LabController {
  constructor(
    private readonly projects: LabProjectsService,
    private readonly schedules: LabSchedulesService,
    private readonly runs: LabRunsService,
  ) {}

  @Get('projects')
  listProjects(@CurrentUser() user: { id: number }) {
    return this.projects.list(user.id);
  }

  @Post('projects')
  createProject(
    @Body() dto: CreateLabProjectDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.projects.create(user.id, dto);
  }

  @Patch('projects/:id')
  updateProject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLabProjectDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.projects.update(id, user.id, dto);
  }

  @Post('projects/:id/check')
  @HttpCode(HttpStatus.OK)
  checkProject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.projects.check(id, user.id);
  }

  @Delete('projects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeProject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    await this.projects.remove(id, user.id);
  }

  @Get('schedules')
  listSchedules(@CurrentUser() user: { id: number }) {
    return this.schedules.list(user.id);
  }

  @Post('schedules')
  createSchedule(
    @Body() dto: SaveLabScheduleDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.schedules.save(user.id, dto);
  }

  @Put('schedules/:id')
  updateSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveLabScheduleDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.schedules.save(user.id, dto, id);
  }

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSchedule(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    await this.schedules.remove(id, user.id);
  }

  @Post('schedules/:id/run')
  @HttpCode(HttpStatus.OK)
  runSchedule(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.schedules.runNow(id, user.id);
  }

  @Get('runs')
  listRuns(@CurrentUser() user: { id: number }) {
    return this.runs.list(user.id);
  }

  @Post('runs')
  startRun(@Body() dto: StartLabRunDto, @CurrentUser() user: { id: number }) {
    return this.runs.start(user.id, dto);
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRun(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.runs.cancel(id, user.id);
  }

  @Post('runs/:id/retry-publish')
  @HttpCode(HttpStatus.OK)
  retryPublish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.runs.retryPublish(id, user.id);
  }
}
