import { TaskQuestion } from '../entities/task-question.entity';

export class QuestionItemDto {
  id: number;
  text: string;
  resolved: boolean;
  answer: string | null;
  // The run the question came from, or null when unknown.
  jobId: number | null;
  createdAt: Date;

  static fromEntity(q: TaskQuestion): QuestionItemDto {
    return {
      id: q.id,
      text: q.text,
      resolved: q.resolvedAt !== null,
      answer: q.answer ?? null,
      jobId: q.jobId ?? null,
      createdAt: q.createdAt,
    };
  }
}

export class QuestionCardDto {
  taskKey: string;
  // The tag: the project number, or null for a task that has none.
  project: string | null;
  questions: QuestionItemDto[];
  openCount: number;
  // Every question is resolved.
  archived: boolean;
  // The newest activity on the card (a question added or ticked), for ordering.
  updatedAt: Date;
}
