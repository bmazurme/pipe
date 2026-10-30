import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { BoardAgentKeyAllowed } from '../auth/decorators/board-agent-key-allowed.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { DeployResult } from './entities/deploy-record.entity';
import { DeployOutcome, LoopDeployService } from './loop-deploy.service';

const SHA = /^[0-9a-f]{7,40}$/;

export class DeployReportDto {
  @IsIn(['deployed', 'rolled_back', 'failed'])
  result: DeployResult;

  @IsString()
  @Matches(SHA)
  sha: string;

  @IsOptional()
  @IsString()
  @Matches(SHA)
  previousSha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}

// What the board that deploys (infra/autodeploy) calls after every release: the OWNER's key, the same boards-only one the board agent uses.
@Controller('api/v1/loop/deploys')
@UseGuards(JwtOrApiKeyGuard, OwnerGuard)
@BoardAgentKeyAllowed()
export class LoopDeployController {
  constructor(private readonly deploys: LoopDeployService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  report(@Body() dto: DeployReportDto): Promise<DeployOutcome> {
    return this.deploys.record(dto);
  }
}
