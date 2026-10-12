import {
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from './decorators/current-user.decorator';
import { AuthProvider } from './entities/auth-identity.entity';
import { JwtGuard } from './guards/jwt.guard';
import { IdentitiesService, IdentityView } from './identities.service';

const PROVIDERS = { yandex: 'yandex', github: 'github' } as const;

// Browser session only (never an API key): changing how an account can be
// entered must not be doable by a leaked machine key.
@Controller('api/v1/auth/identities')
@UseInterceptors(ClassSerializerInterceptor)
@UseGuards(JwtGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class IdentitiesController {
  constructor(private readonly identitiesService: IdentitiesService) {}

  @Get()
  @ApiOperation({ summary: 'Sign-in methods connected to the current user' })
  list(@CurrentUser() currentUser: { id: number }): Promise<IdentityView[]> {
    return this.identitiesService.list(currentUser.id);
  }

  @Post(':provider/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Allow signing in with this method' })
  enable(
    @Param('provider', new ParseEnumPipe(PROVIDERS)) provider: AuthProvider,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    return this.identitiesService.setEnabled(currentUser.id, provider, true);
  }

  @Post(':provider/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Forbid signing in with this method (409 if it is the last enabled one)',
  })
  disable(
    @Param('provider', new ParseEnumPipe(PROVIDERS)) provider: AuthProvider,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    return this.identitiesService.setEnabled(currentUser.id, provider, false);
  }

  @Delete(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disconnect this method (409 if it is the last enabled one)',
  })
  unlink(
    @Param('provider', new ParseEnumPipe(PROVIDERS)) provider: AuthProvider,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    return this.identitiesService.unlink(currentUser.id, provider);
  }
}
