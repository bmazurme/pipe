import type { Response } from 'express';
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
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { multerExceptionFilterFor } from '../uploads/multer-exception.filter';
import { DiscardUploadOnErrorInterceptor } from '../uploads/discard-upload-on-error.interceptor';
import {
  assetMulterConfig,
  landingMulterConfig,
  MAX_ASSET_BYTES,
} from './config/promo-multer.config';
import {
  CreatePromoPostDto,
  MarkPublishedDto,
  UpdatePromoPostDto,
} from './dto/promo-post.dto';
import {
  PromoAssetResponseDto,
  PromoPostResponseDto,
} from './dto/promo-response.dto';
import { LANDING_MAX_ZIP_BYTES } from './landing-files';
import {
  PROMO_CHANNELS,
  PROMO_POST_STATUSES,
  type PromoChannel,
  type PromoPostStatus,
} from './promo-limits';
import { PromoAssetsService } from './promo-assets.service';
import {
  type LandingReleaseView,
  type LandingState,
  PromoLandingService,
} from './promo-landing.service';
import {
  type PromoOverview,
  PromoOverviewService,
} from './promo-overview.service';
import { PromoPostsService } from './promo-posts.service';
import { PromoPublisherService } from './promo-publisher.service';
import {
  type TargetView,
  type TelegramState,
  PromoTelegramService,
} from './promo-telegram.service';
import { BindTargetDto, TelegramRoleParam } from './dto/promo-telegram.dto';

const AssetTooLarge = multerExceptionFilterFor(
  MAX_ASSET_BYTES,
  (mb) => `Файл больше ${mb} МБ`,
);
const LandingTooLarge = multerExceptionFilterFor(
  LANDING_MAX_ZIP_BYTES,
  (mb) => `Архив больше ${mb} МБ`,
);

function oneOf<T extends string>(
  what: string,
  allowed: readonly T[],
  value: string | undefined,
): T | undefined {
  if (value === undefined || value === '') return undefined;

  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`${what}: допустимо ${allowed.join(', ')}`);
  }

  return value as T;
}

// The promo module is the owner's alone (one deployment, one owner): a browser session, never an API key.
@Controller('api/v1/promo')
@UseGuards(JwtGuard, OwnerGuard)
export class PromoController {
  constructor(
    private readonly posts: PromoPostsService,
    private readonly assets: PromoAssetsService,
    private readonly landing: PromoLandingService,
    private readonly overviewService: PromoOverviewService,
    private readonly publisher: PromoPublisherService,
    private readonly telegram: PromoTelegramService,
  ) {}

  @Get('overview')
  overview(): Promise<PromoOverview> {
    return this.overviewService.overview();
  }

  // --- posts

  @Get('posts')
  async listPosts(
    @Query('channel') channel?: string,
    @Query('status') status?: string,
  ): Promise<PromoPostResponseDto[]> {
    const rows = await this.posts.list({
      channel: oneOf<PromoChannel>('channel', PROMO_CHANNELS, channel),
      status: oneOf<PromoPostStatus>('status', PROMO_POST_STATUSES, status),
    });

    return rows.map(PromoPostResponseDto.fromEntity);
  }

  @Post('posts')
  async createPost(
    @Body() dto: CreatePromoPostDto,
  ): Promise<PromoPostResponseDto> {
    return PromoPostResponseDto.fromEntity(await this.posts.create(dto));
  }

  @Get('posts/:id')
  async getPost(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PromoPostResponseDto> {
    return PromoPostResponseDto.fromEntity(await this.posts.get(id));
  }

  @Patch('posts/:id')
  async updatePost(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePromoPostDto,
  ): Promise<PromoPostResponseDto> {
    return PromoPostResponseDto.fromEntity(await this.posts.update(id, dto));
  }

  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePost(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.posts.remove(id);
  }

  @Post('posts/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PromoPostResponseDto> {
    return PromoPostResponseDto.fromEntity(await this.posts.approve(id));
  }

  @Post('posts/:id/unapprove')
  @HttpCode(HttpStatus.OK)
  async unapprove(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PromoPostResponseDto> {
    return PromoPostResponseDto.fromEntity(await this.posts.unapprove(id));
  }

  @Post('posts/:id/published')
  @HttpCode(HttpStatus.OK)
  async markPublished(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkPublishedDto,
  ): Promise<PromoPostResponseDto> {
    return PromoPostResponseDto.fromEntity(
      await this.posts.markPublished(id, dto.externalUrl),
    );
  }

  // Out now, whatever its time (an approved Telegram post), and a preview to the owner's own chat.
  @Post('posts/:id/publish-now')
  @HttpCode(HttpStatus.OK)
  async publishNow(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PromoPostResponseDto> {
    return PromoPostResponseDto.fromEntity(await this.publisher.publishNow(id));
  }

  @Post('posts/:id/test')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sendTest(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.telegram.sendTest(await this.posts.get(id));
  }

  // --- Telegram: the channel for the news and the group for the discussion

  @Get('telegram')
  telegramState(): Promise<TelegramState> {
    return this.telegram.state();
  }

  @Post('telegram/targets/:role')
  @HttpCode(HttpStatus.OK)
  bindTarget(
    @Param() params: TelegramRoleParam,
    @Body() dto: BindTargetDto,
  ): Promise<TargetView> {
    return this.telegram.bind(params.role, dto.chat);
  }

  @Delete('telegram/targets/:role')
  @HttpCode(HttpStatus.NO_CONTENT)
  unbindTarget(@Param() params: TelegramRoleParam): Promise<void> {
    return this.telegram.unbind(params.role);
  }

  // --- files a post carries

  @Get('assets')
  async listAssets(): Promise<PromoAssetResponseDto[]> {
    return (await this.assets.list()).map(PromoAssetResponseDto.fromEntity);
  }

  @Post('assets')
  @UseFilters(AssetTooLarge)
  @UseInterceptors(
    FileInterceptor('file', assetMulterConfig),
    DiscardUploadOnErrorInterceptor,
  )
  async uploadAsset(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<PromoAssetResponseDto> {
    if (!file) throw new BadRequestException('Файл не передан');

    return PromoAssetResponseDto.fromEntity(await this.assets.upload(file));
  }

  @Get('assets/:id/content')
  async assetContent(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    this.assets.send(res, await this.assets.get(id));
  }

  @Delete('assets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAsset(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.assets.remove(id);
  }

  // --- the landing page

  @Get('landing')
  landingState(): Promise<LandingState> {
    return this.landing.state();
  }

  @Post('landing/releases')
  @UseFilters(LandingTooLarge)
  @UseInterceptors(
    FileInterceptor('file', landingMulterConfig),
    DiscardUploadOnErrorInterceptor,
  )
  uploadRelease(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('label') label?: string,
  ): Promise<LandingReleaseView> {
    if (!file) throw new BadRequestException('Файл не передан');

    return this.landing.upload(
      file,
      typeof label === 'string' ? label : undefined,
    );
  }

  @Post('landing/releases/:id/activate')
  @HttpCode(HttpStatus.OK)
  activateRelease(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LandingReleaseView> {
    return this.landing.activate(id);
  }

  @Delete('landing/releases/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRelease(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.landing.remove(id);
  }
}
