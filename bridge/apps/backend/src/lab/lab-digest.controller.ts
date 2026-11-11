import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import {
  DigestWeekQueryDto,
  SaveLabDigestSettingsDto,
  StartLabDigestDto,
  UpdateLabDigestDto,
} from './dto/lab-digest.dto';
import { LabDigestService } from './lab-digest.service';

// Browser session only, like the rest of Lab: it starts paid worker runs over the owner's work history. Every row is the caller's own.
@Controller('api/v1/lab/digests')
@UseGuards(JwtGuard)
export class LabDigestController {
  constructor(private readonly digests: LabDigestService) {}

  @Get()
  list(@CurrentUser() user: { id: number }) {
    return this.digests.list(user.id);
  }

  @Get('settings')
  getSettings(@CurrentUser() user: { id: number }) {
    return this.digests.getSettings(user.id);
  }

  @Put('settings')
  saveSettings(
    @Body() dto: SaveLabDigestSettingsDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.digests.saveSettings(user.id, dto);
  }

  // What a digest of the week would be made of, without starting anything.
  @Get('preview')
  preview(
    @Query() query: DigestWeekQueryDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.digests.preview(user.id, query.weekStart, query.includePrivate);
  }

  @Post()
  start(@Body() dto: StartLabDigestDto, @CurrentUser() user: { id: number }) {
    return this.digests.start(user.id, dto);
  }

  @Get(':id')
  get(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.digests.findOwned(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLabDigestDto,
    @CurrentUser() user: { id: number },
  ) {
    return this.digests.update(id, user.id, dto);
  }

  // "Перенёс в notes": P0 has no automatic delivery to notes.ntlstl.dev.
  @Post(':id/exported')
  @HttpCode(HttpStatus.OK)
  markExported(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.digests.markExported(id, user.id);
  }

  // Sends the draft to notes.ntlstl.dev — still unpublished there.
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.digests.send(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ): Promise<void> {
    await this.digests.remove(id, user.id);
  }
}
