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
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateProviderCredentialDto } from './dto/create-provider-credential.dto';
import { ProviderCredentialResponseDto } from './dto/provider-credential-response.dto';
import { ProviderCredentialsService } from './provider-credentials.service';

// Browser session only: a worker never lists or reads these — it receives the one key a job needs, inside the claim.
@Controller('api/v1/worker/provider-credentials')
@UseGuards(JwtGuard)
export class ProviderCredentialsController {
  constructor(private readonly service: ProviderCredentialsService) {}

  @Get()
  async list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<ProviderCredentialResponseDto[]> {
    const credentials = await this.service.findAllByUser(currentUser.id);

    return credentials.map(ProviderCredentialResponseDto.fromEntity);
  }

  @Post()
  async create(
    @Body() dto: CreateProviderCredentialDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<ProviderCredentialResponseDto> {
    const credential = await this.service.create(currentUser.id, dto);

    return ProviderCredentialResponseDto.fromEntity(credential);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.service.remove(id, currentUser.id);
  }
}
