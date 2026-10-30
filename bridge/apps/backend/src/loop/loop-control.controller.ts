import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { LoopControlService, LoopControlState } from './loop-control.service';

export class PauseLoopDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

// Browser session only (the Improve page): the owner's kill-switch.
@Controller('api/v1/loop/control')
@UseGuards(JwtGuard)
export class LoopControlController {
  constructor(private readonly control: LoopControlService) {}

  @Get()
  state(): Promise<LoopControlState> {
    return this.control.state();
  }

  @Post('pause')
  async pause(@Body() dto: PauseLoopDto): Promise<LoopControlState> {
    await this.control.pause(dto.reason?.trim() || null, 'owner');

    return this.control.state();
  }

  @Post('resume')
  async resume(): Promise<LoopControlState> {
    await this.control.resume();

    return this.control.state();
  }
}
