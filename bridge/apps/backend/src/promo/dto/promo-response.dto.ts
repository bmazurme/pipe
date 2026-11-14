import type { PromoAsset } from '../entities/promo-asset.entity';
import type { PromoPost } from '../entities/promo-post.entity';
import {
  captionLength,
  captionLimit,
  joinCaption,
  type PromoChannel,
  type PromoMode,
  type PromoPostStatus,
} from '../promo-limits';

export class PromoPostResponseDto {
  id: number;
  channel: PromoChannel;
  title: string;
  textRu: string;
  textEn: string;
  assetIds: number[];
  mode: PromoMode;
  scheduledAt: Date | null;
  status: PromoPostStatus;
  externalUrl: string | null;
  error: string | null;
  publishedAt: Date | null;
  utmCampaign: string | null;
  announceInGroup: boolean;
  // How long the joined caption is and what the channel allows, so the editor can show «812 / 1024» without knowing the limits.
  captionLength: number;
  captionLimit: number;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(post: PromoPost): PromoPostResponseDto {
    return {
      id: post.id,
      channel: post.channel,
      title: post.title,
      textRu: post.textRu,
      textEn: post.textEn,
      assetIds: post.assetIds,
      mode: post.mode,
      scheduledAt: post.scheduledAt,
      status: post.status,
      externalUrl: post.externalUrl,
      error: post.error,
      publishedAt: post.publishedAt,
      utmCampaign: post.utmCampaign,
      announceInGroup: post.announceInGroup,
      captionLength: captionLength(
        post.channel,
        joinCaption(post.textRu, post.textEn),
      ),
      captionLimit: captionLimit(post.channel, post.assetIds.length > 0).limit,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }
}

export class PromoAssetResponseDto {
  id: number;
  originalName: string;
  mime: string;
  size: number;
  createdAt: Date;

  static fromEntity(asset: PromoAsset): PromoAssetResponseDto {
    return {
      id: asset.id,
      originalName: asset.originalName,
      mime: asset.mime,
      size: asset.size,
      createdAt: asset.createdAt,
    };
  }
}
