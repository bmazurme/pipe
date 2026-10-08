import { Context } from '../entities/context.entity';

export class ContextResponseDto {
  id: number;
  name: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(context: Context): ContextResponseDto {
    return {
      id: context.id,
      name: context.name,
      content: context.content,
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
    };
  }
}
