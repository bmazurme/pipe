import {
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
import {
  SaveScheduleDto,
  SaveSettingsDto,
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
  issues(@Query('label') label?: string) {
    return this.improve.listIssues(label || undefined);
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
