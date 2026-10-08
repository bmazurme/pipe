import {
  BadRequestException,
  Body,
  Controller,
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
import { ALL_CATEGORIES, AnalysisCategory, isCategory } from './analysis';
import {
  CreateIssuesDto,
  SaveScheduleDto,
  SaveSettingsDto,
  StartAnalysisDto,
  StartItemsDto,
  StartManyDto,
  StartRunDto,
} from './dto/improve.dto';
import { ImproveService } from './improve.service';

// Browser session only: this starts paid worker runs and opens pull requests, so
// it is not reachable with a machine API key.
@Controller('api/v1/improve')
@UseGuards(JwtGuard)
export class ImproveController {
  constructor(private readonly improve: ImproveService) {}

  @Get('status')
  status() {
    return this.improve.status();
  }

  @Get('issues')
  issues(@Query('label') label?: string, @Query('all') all?: string) {
    return this.improve.listIssues(label || undefined, all === '1');
  }

  @Get('runs')
  runs(@Query('limit') limit?: string) {
    return this.improve.listRuns(limit ? Number(limit) : undefined);
  }

  @Post('runs')
  startRun(@Body() dto: StartRunDto, @CurrentUser() user: { id: number }) {
    return this.improve.startRun(user.id, dto.issueNumber, dto.model);
  }

  @Post('runs/:id/cancel')
  cancelRun(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.cancelRun(id, user.id);
  }

  @Post('analysis')
  startAnalysis(
    @Body() dto: StartAnalysisDto,
    @CurrentUser() user: { id: number },
  ) {
    const categories = dto.categories?.length ? dto.categories : ALL_CATEGORIES;

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
    return this.improve.createIssues(id, dto.indices);
  }

  @Get('schedules')
  schedules() {
    return this.improve.listSchedules();
  }

  @Post('schedules')
  createSchedule(
    @Body() dto: SaveScheduleDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.saveSchedule(user.id, dto);
  }

  @Put('schedules/:id')
  updateSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveScheduleDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.improve.saveSchedule(user.id, dto, id);
  }

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSchedule(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.improve.deleteSchedule(id);
  }

  @Post('schedules/:id/run')
  runScheduleNow(@Param('id', ParseIntPipe) id: number) {
    return this.improve.runScheduleNow(id);
  }

  @Get('settings')
  async settings(@CurrentUser() user: { id: number }) {
    const settings = await this.improve.getSettings(user.id);

    return { autoStartModel: settings?.autoStartModel ?? null };
  }

  @Put('settings')
  async saveSettings(
    @Body() dto: SaveSettingsDto,
    @CurrentUser() user: { id: number },
  ) {
    const saved = await this.improve.saveSettings(
      user.id,
      dto.autoStartModel || null,
    );

    return { autoStartModel: saved.autoStartModel };
  }
}
