export class QuestionItemDto {
  id: number;
  text: string;
  resolved: boolean;
  answer: string | null;
  // The run the question came from, or null when unknown.
  jobId: number | null;
  createdAt: Date;
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
