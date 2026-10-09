import { Context } from '../entities/context.entity';

// What a list needs to tell contexts apart — never the text itself (see
// ContextService.findAllByUser). ContextResponseDto carries the text, for one context.
export class ContextSummaryDto {
  id: number;
  name: string;
  // Characters in the text, or null for a context saved before the size was recorded.
  contentLength: number | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(context: Context): ContextSummaryDto {
    return {
      id: context.id,
      name: context.name,
      contentLength: context.contentLength ?? null,
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
    };
  }
}
