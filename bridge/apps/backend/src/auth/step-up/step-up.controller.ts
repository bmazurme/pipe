import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtGuard } from '../guards/jwt.guard';
import {
  StepUpCodeDto,
  StepUpGrantResponseDto,
  StepUpRecoveryCodesResponseDto,
  StepUpSetupResponseDto,
  StepUpStatusResponseDto,
} from './step-up.dto';
import { StepUpService } from './step-up.service';

// The second factor for dangerous actions (DEVELOPMENT-PLAN.md S6). Browser session only: a machine key has no
// phone to ask. Every route that takes a code is throttled hard on top of the service's own lock.
@ApiTags('auth')
@Controller('api/v1/auth/2fa')
@UseGuards(JwtGuard)
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @Get()
  @ApiOperation({
    summary:
      'Is two-factor protection on, and how many recovery codes are left',
  })
  status(
    @CurrentUser() user: { id: number },
  ): Promise<StepUpStatusResponseDto> {
    return this.stepUp.status(user.id);
  }

  @Post('setup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Start the setup: a new secret and the otpauth:// link for a QR code',
  })
  setup(@CurrentUser() user: { id: number }): Promise<StepUpSetupResponseDto> {
    return this.stepUp.setup(user.id);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Confirm the setup with the first code; returns the recovery codes, once',
  })
  async enable(
    @CurrentUser() user: { id: number },
    @Body() dto: StepUpCodeDto,
  ): Promise<StepUpRecoveryCodesResponseDto> {
    return { recoveryCodes: await this.stepUp.enable(user.id, dto.code) };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Exchange a code (or a recovery code) for a five-minute grant, sent as X-Step-Up',
  })
  verify(
    @CurrentUser() user: { id: number; sessionId: number },
    @Body() dto: StepUpCodeDto,
  ): Promise<StepUpGrantResponseDto> {
    return this.stepUp.issueGrant(user.id, user.sessionId, dto.code);
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Turn the protection off (needs a valid code)' })
  async disable(
    @CurrentUser() user: { id: number },
    @Body() dto: StepUpCodeDto,
  ): Promise<void> {
    await this.stepUp.disable(user.id, dto.code);
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Replace the recovery codes (needs a valid code); the new ones are returned once',
  })
  async recoveryCodes(
    @CurrentUser() user: { id: number },
    @Body() dto: StepUpCodeDto,
  ): Promise<StepUpRecoveryCodesResponseDto> {
    return {
      recoveryCodes: await this.stepUp.regenerateRecoveryCodes(
        user.id,
        dto.code,
      ),
    };
  }
}
