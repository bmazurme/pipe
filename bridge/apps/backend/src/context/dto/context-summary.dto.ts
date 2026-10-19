import { ApiProperty } from '@nestjs/swagger';

import type { ContextUsage } from '../context.service';
import { Context } from '../entities/context.entity';

export class ContextScheduleRefDto {
  id: number;
  name: string;
}

// What a list needs to tell contexts apart — never the text itself (see
// ContextService.findAllByUser). ContextResponseDto carries the text, for one context.
export class ContextSummaryDto {
  id: number;
  name: string;
  // Characters in the text, or null for a context saved before the size was recorded.
  contentLength: number | null;
  createdAt: Date;
  updatedAt: Date;
  // Improve schedules that hand this context to their runs.
  @ApiProperty({ type: () => [ContextScheduleRefDto] })
  schedules: ContextScheduleRefDto[];
  // Newest job launched with a context of this name, or null if none.
  lastUsedAt: Date | null;

  static fromEntity(
    context: Context & Partial<ContextUsage>,
  ): ContextSummaryDto {
    return {
      id: context.id,
      name: context.name,
      contentLength: context.contentLength ?? null,
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
      schedules: context.schedules ?? [],
      lastUsedAt: context.lastUsedAt ?? null,
    };
  }
}
