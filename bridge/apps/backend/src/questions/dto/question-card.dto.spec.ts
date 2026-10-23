import { TaskQuestion } from '../entities/task-question.entity';
import { QuestionItemDto } from './question-card.dto';

describe('QuestionItemDto.fromEntity', () => {
  const createdAt = new Date('2026-01-01T00:00:00Z');

  it('maps a resolved question with an answer and a job', () => {
    const dto = QuestionItemDto.fromEntity({
      id: 1,
      text: 'Why?',
      resolvedAt: new Date(),
      answer: 'Because',
      jobId: 7,
      createdAt,
    } as TaskQuestion);

    expect(dto).toEqual({
      id: 1,
      text: 'Why?',
      resolved: true,
      answer: 'Because',
      jobId: 7,
      createdAt,
    });
  });

  it('maps an unresolved question with null/undefined answer and jobId to null', () => {
    const dto = QuestionItemDto.fromEntity({
      id: 2,
      text: 'How?',
      resolvedAt: null,
      answer: undefined,
      jobId: null,
      createdAt,
    } as unknown as TaskQuestion);

    expect(dto.resolved).toBe(false);
    expect(dto.answer).toBeNull();
    expect(dto.jobId).toBeNull();
  });
});
