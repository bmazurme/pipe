import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { AnalysisCategory, DEFAULT_CATEGORIES, isCategory } from './analysis';
import {
  CreateImproveIssueDto,
  CreateIssuesDto,
  SaveScheduleDto,
  SaveSettingsDto,
  StartAnalysisDto,
  StartItemsDto,
  StartManyDto,
  StartPrFixDto,
  StartPrMergeDto,
  StartRunDto,
} from './dto/improve.dto';
import { ImproveAutoStartService } from './improve-auto-start.service';
import { ImproveIssueFilingService } from './improve-issue-filing.service';
import { ImproveScheduleService } from './improve-schedule.service';
import { ImproveService } from './improve.service';

// Browser session only: this starts paid worker runs and opens pull requests, so
// it is not reachable with a machine API key. Improve is system-wide, so it is
// also owner-only (the EMAILS list when set, otherwise the first account).
@Controller('api/v1/improve')
@UseGuards(JwtGuard, OwnerGuard)
export class ImproveController {
  constructor(
    private readonly improve: ImproveService,
    private readonly scheduleService: ImproveScheduleService,
    private readonly autoStart: ImproveAutoStartService,
    private readonly issueFiling: ImproveIssueFilingService,
  ) {}

  @Get('status')
  status() {
    return this.improve.status();
  }

  @Get('issues')
  issues(@Query('label') label?: string, @Query('all') all?: string) {
    return this.improve.listIssues(label || undefined, all === '1');
  }

  // Files a hand-written issue labelled for Improve, optionally starting a run on it.
  @Post('issues')
  createIssue(
    @Body() dto: CreateImproveIssueDto,
    @CurrentUser() user: { id: number },
  ) {
    const model = dto.model;

    if (dto.start && !model) {
      throw new BadRequestException('Для запуска выберите модель');
    }

    return this.issueFiling.createManualIssue(
      dto,
      dto.start && model
        ? (number) => this.improve.startRun(user.id, number, model)
        : undefined,
    );
  }

  @Get('runs')
  runs(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.improve.listRuns(limit);
  }

  @Get('runs/:id')
  run(@Param('id', ParseIntPipe) id: number) {
    return this.improve.getRun(id);
  }

  @Post('runs')
  startRun(@Body() dto: StartRunDto, @CurrentUser() user: { id: number }) {
    return this.improve.startRun(user.id, dto.issueNumber, dto.model);
  }

  // The chat's "fix this PR" card, after the person confirmed it.
  @Post('pr-fix')
  startPrFix(@Body() dto: StartPrFixDto, @CurrentUser() user: { id: number }) {
    return this.improve.startPrFix(
      user.id,
      dto.prNumber,
      dto.instruction,
      dto.model,
    );
  }

  // The chat's "merge this PR" card, after the person confirmed it.
  @Post('pr-merge')
  startPrMerge(@Body() dto: StartPrMergeDto) {
    return this.improve.startPrMerge(dto.prNumber);
  }

  @Post('runs/:id/cancel')
  cancelRun(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.cancelRun(id, user.id);
  }

  @Post('runs/:id/retry-publish')
  retryPublish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.retryPublish(id, user.id);
  }

  @Post('analysis')
  startAnalysis(
    @Body() dto: StartAnalysisDto,
    @CurrentUser() user: { id: number },
  ) {
    const categories = dto.categories?.length
      ? dto.categories
      : DEFAULT_CATEGORIES;

    if (!categories.every(isCategory)) {
      throw new BadRequestException('Неизвестное направление анализа');
    }

    return this.improve.startAnalysis(
      user.id,
      dto.model,
      categories as AnalysisCategory[],
      dto.autoCreate === true || dto.autoStart === true,
      'manual',
      null,
      dto.autoStart === true,
    );
  }

  // Several issues into work at once: each is started independently.
  @Post('runs/batch')
  startMany(@Body() dto: StartManyDto, @CurrentUser() user: { id: number }) {
    return this.improve.startMany(user.id, dto.issueNumbers, dto.model);
  }

  // Files the chosen proposals of a finished analysis and starts a run for each.
  @Post('runs/:id/start-items')
  startItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartItemsDto,
  ) {
    return this.improve.startItems(id, dto.model, dto.indices);
  }

  // Files the chosen proposals of a finished analysis as GitHub issues.
  @Post('runs/:id/create-issues')
  createIssues(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateIssuesDto,
  ) {
    return this.issueFiling.createIssues(id, dto.indices);
  }

  @Get('schedules')
  schedules() {
    return this.scheduleService.listSchedules();
  }

  @Post('schedules')
  createSchedule(
    @Body() dto: SaveScheduleDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.scheduleService.saveSchedule(user.id, dto);
  }

  @Put('schedules/:id')
  updateSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveScheduleDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.scheduleService.saveSchedule(user.id, dto, id);
  }

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSchedule(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.scheduleService.deleteSchedule(id);
  }

  @Post('schedules/:id/run')
  runScheduleNow(@Param('id', ParseIntPipe) id: number) {
    return this.scheduleService.runScheduleNow(id);
  }

  @Get('settings')
  async settings(@CurrentUser() user: { id: number }) {
    const settings = await this.autoStart.getSettings(user.id);

    return {
      autoStartModel: settings?.autoStartModel ?? null,
      autoRepairCi: settings?.autoRepairCi ?? true,
    };
  }

  @Put('settings')
  async saveSettings(
    @Body() dto: SaveSettingsDto,
    @CurrentUser() user: { id: number },
  ) {
    const current = await this.autoStart.getSettings(user.id);
    const saved = await this.autoStart.saveSettings(
      user.id,
      // Each of the two switches is saved on its own: a missing field keeps what is stored.
      dto.autoStartModel === undefined
        ? (current?.autoStartModel ?? null)
        : dto.autoStartModel || null,
      dto.autoRepairCi,
    );

    return {
      autoStartModel: saved.autoStartModel,
      autoRepairCi: saved.autoRepairCi,
    };
  }
}
