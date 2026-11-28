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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { AnalysisCategory, DEFAULT_CATEGORIES, isCategory } from './analysis';
import {
  CreateImproveIssueDto,
  CreateIssuesDto,
  DeclineItemDto,
  SaveKnowledgeDto,
  SaveScheduleDto,
  SaveSettingsDto,
  StartAnalysisDto,
  StartItemsDto,
  StartManyDto,
  StartPrFixDto,
  StartPrMergeDto,
  StartRunDto,
} from './dto/improve.dto';
import { ContextService } from '../context/context.service';
import { escalationFromSettings, type EscalationSettings } from './escalation';
import { ImproveAutoStartService } from './improve-auto-start.service';
import { ImproveEscalationService } from './improve-escalation.service';
import { ImproveIssueFilingService } from './improve-issue-filing.service';
import { ImproveKnowledgeService } from './improve-knowledge.service';
import { ImproveQualityService } from './improve-quality.service';
import { RouterSettingsService } from '../router/router-settings.service';
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
    private readonly contexts: ContextService,
    private readonly quality: ImproveQualityService,
    private readonly escalation: ImproveEscalationService,
    private readonly routerSettings: RouterSettingsService,
    private readonly knowledge: ImproveKnowledgeService,
  ) {}

  // A context named in a request must be one of the caller's own (404 otherwise, like a schedule's); no context = null.
  private async ownContext(
    userId: number,
    contextId: number | null | undefined,
  ): Promise<number | null> {
    if (contextId === undefined || contextId === null) return null;

    await this.contexts.findOwned(contextId, userId);

    return contextId;
  }

  @Get('status')
  status() {
    return this.improve.status();
  }

  @Get('issues')
  issues(
    @Query('label') label?: string,
    @Query('all') all?: string,
    @Query('fresh') fresh?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    return this.improve.listIssues(
      label || undefined,
      all === '1',
      fresh === '1',
      (since) =>
        res?.setHeader('X-Issues-Stale-Since', new Date(since).toISOString()),
    );
  }

  // Files a hand-written issue labelled for Improve, optionally starting a run on it.
  @Post('issues')
  async createIssue(
    @Body() dto: CreateImproveIssueDto,
    @CurrentUser() user: { id: number },
  ) {
    const model = dto.model;

    if (dto.start && !model) {
      throw new BadRequestException('Для запуска выберите модель');
    }

    // Checked before the issue is filed: a bad context must not leave an issue behind.
    const contextId = dto.start
      ? await this.ownContext(user.id, dto.contextId)
      : null;

    return this.issueFiling.createManualIssue(
      dto,
      dto.start && model
        ? (number) =>
            this.improve.startRun(
              user.id,
              number,
              model,
              'manual',
              null,
              contextId,
            )
        : undefined,
    );
  }

  // A1: how good the assistant is, in numbers — first-attempt CI, repairs, time to merge, cost per merged pull request, reverts; by model and tier.
  @Get('quality')
  qualityView(
    @Query('days', new DefaultValuePipe(90), ParseIntPipe) days: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.quality.summary(user.id, Math.min(Math.max(days, 1), 365));
  }

  // A10: model cards — what each model closes at each size tier (success, first CI, repairs, work time, cost), and the router's table checked against them.
  // Advice only: the owner applies a change in the router settings.
  @Get('quality/model-cards')
  async modelCards(
    @Query('days', new DefaultValuePipe(90), ParseIntPipe) days: number,
    @CurrentUser() user: { id: number },
  ) {
    const settings = await this.routerSettings.get(user.id);

    return this.quality.modelCards(
      user.id,
      Math.min(Math.max(days, 1), 365),
      settings.tierModels,
    );
  }

  // Reads GitHub again now instead of waiting for the next scheduled sync (at most 40 pull requests per call; `remaining` says how many are left).
  @Post('quality/refresh')
  @HttpCode(HttpStatus.OK)
  refreshQuality(@CurrentUser() user: { id: number }) {
    return this.quality.sync(user.id);
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
  async startRun(
    @Body() dto: StartRunDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.startRun(
      user.id,
      dto.issueNumber,
      dto.model,
      'manual',
      null,
      await this.ownContext(user.id, dto.contextId),
    );
  }

  // A8: «сохранить как постоянное знание» (Questions, Context) — a pull request that adds the entry to CLAUDE.md or docs/knowledge.md.
  @Post('knowledge')
  saveKnowledge(
    @Body() dto: SaveKnowledgeDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.knowledge.save(user.id, dto);
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

  // A6: a run that waits for the owner's answers starts now, with the answers there are.
  @Post('runs/:id/continue')
  continueRun(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.continueRun(id, user.id);
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

    return this.ownContext(user.id, dto.contextId).then((contextId) =>
      this.improve.startAnalysis(
        user.id,
        dto.model,
        categories as AnalysisCategory[],
        dto.autoCreate === true || dto.autoStart === true,
        'manual',
        null,
        dto.autoStart === true,
        contextId,
      ),
    );
  }

  // Several issues into work at once: each is started independently.
  @Post('runs/batch')
  async startMany(
    @Body() dto: StartManyDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.startMany(
      user.id,
      dto.issueNumbers,
      dto.model,
      await this.ownContext(user.id, dto.contextId),
    );
  }

  // Files the chosen proposals of a finished analysis and starts a run for each.
  @Post('runs/:id/start-items')
  async startItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartItemsDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.startItems(
      id,
      dto.model,
      dto.indices,
      await this.ownContext(user.id, dto.contextId),
    );
  }

  // The owner turns a proposal down with a reason; the next analysis is told why. DELETE takes it back.
  @Post('runs/:id/items/:index/decline')
  declineItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: DeclineItemDto,
  ) {
    return this.issueFiling.setDeclined(id, index, dto.reason);
  }

  @Delete('runs/:id/items/:index/decline')
  restoreItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.issueFiling.setDeclined(id, index, null);
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
      autoRedoConflicts: settings?.autoRedoConflicts ?? false,
      clarifyBeforeRun: settings?.clarifyBeforeRun ?? 'off',
      ...(await this.escalationView(user.id, escalationFromSettings(settings))),
      ...(await this.autoStart.getFilingLimits(user.id)),
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
      dto.autoRedoConflicts,
      dto.clarifyBeforeRun,
    );
    const escalation = await this.autoStart.saveEscalation(user.id, {
      enabled: dto.escalateOnFailure,
      capTaskUsd: dto.escalationCapTaskUsd,
      capDayUsd: dto.escalationCapDayUsd,
    });
    const limits = await this.autoStart.saveFilingLimits(user.id, {
      minValue: dto.minValue,
      maxOpenPerCategory: dto.maxOpenPerCategory,
      dailyIssueCap: dto.dailyIssueCap,
    });

    return {
      autoStartModel: saved.autoStartModel,
      autoRepairCi: saved.autoRepairCi,
      autoRedoConflicts: saved.autoRedoConflicts,
      clarifyBeforeRun: saved.clarifyBeforeRun,
      ...(await this.escalationView(user.id, escalation)),
      ...limits,
    };
  }

  // A9: the switch, the two limits and what the last 24 hours of Improve runs have cost so far (a floor: a job that reported no cost counts for nothing).
  private async escalationView(userId: number, settings: EscalationSettings) {
    return {
      escalateOnFailure: settings.enabled,
      escalationCapTaskUsd: settings.capTaskUsd,
      escalationCapDayUsd: settings.capDayUsd,
      escalationSpentDayUsd: (await this.escalation.spend(userId, null)).dayUsd,
    };
  }
}
