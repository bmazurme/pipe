import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RouterPreviewDto, RouterSettingsDto } from './dto/router.dto';
import type { Routing, RouterSettings } from './router-policy';
import { RouterSettingsService } from './router-settings.service';
import { RouterService } from './router.service';

// Browser session only: the owner's own routing choices, never read by a machine.
@Controller('api/v1/router')
@UseGuards(JwtGuard)
export class RouterController {
  constructor(
    private readonly settings: RouterSettingsService,
    private readonly router: RouterService,
  ) {}

  @Get('settings')
  get(@CurrentUser() user: { id: number }): Promise<RouterSettings> {
    return this.settings.get(user.id);
  }

  @Put('settings')
  save(
    @Body() dto: RouterSettingsDto,
    @CurrentUser() user: { id: number },
  ): Promise<RouterSettings> {
    return this.settings.save(user.id, dto as unknown as RouterSettings);
  }

  // Try the router on a task: the model "Авто" would pick, and why. Costs one short question to Haiku unless a rule decides by words.
  @Post('preview')
  preview(
    @Body() dto: RouterPreviewDto,
    @CurrentUser() user: { id: number },
  ): Promise<Routing> {
    return this.router.decide({
      userId: user.id,
      title: dto.task.split('\n')[0].slice(0, 120),
      task: dto.task,
      executor: dto.executor,
    });
  }
}
