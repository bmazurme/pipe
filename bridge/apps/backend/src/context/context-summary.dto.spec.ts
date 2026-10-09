import { ContextSummaryDto } from './dto/context-summary.dto';
import { Context } from './entities/context.entity';

describe('ContextSummaryDto', () => {
  const entity = {
    id: 1,
    name: 'Notes',
    content: 'secret text that must not leak into a list',
    contentLength: 42,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  } as Context;

  it('carries the size but never the text', () => {
    const dto = ContextSummaryDto.fromEntity(entity);

    expect(dto).toEqual({
      id: 1,
      name: 'Notes',
      contentLength: 42,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
    expect(JSON.stringify(dto)).not.toContain('secret text');
  });

  it('reports an unknown size as null for a row saved before it was recorded', () => {
    expect(
      ContextSummaryDto.fromEntity({
        ...entity,
        contentLength: undefined,
      } as unknown as Context).contentLength,
    ).toBeNull();
  });
});
