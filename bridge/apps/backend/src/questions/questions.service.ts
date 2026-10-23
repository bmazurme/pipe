import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MAX_CONTEXT_LENGTH } from '../context/context.limits';
import { ContextService } from '../context/context.service';
import { Job } from '../worker/entities/job.entity';
import { QuestionCardDto } from './dto/question-card.dto';
import { TaskQuestion } from './entities/task-question.entity';
import {
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS_LISTED,
  MAX_QUESTIONS_PER_REPORT,
} from './questions.limits';

// `173:628` → "173". A task that is just a file has no project.
export function projectOf(taskKey: string): string | null {
  const match = /^(\d+):\d+$/.exec(taskKey);

  return match ? match[1] : null;
}

const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
const sameQuestion = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

@Injectable()
export class QuestionsService {
  constructor(
    @InjectRepository(TaskQuestion)
    private readonly questionRepository: Repository<TaskQuestion>,
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    private readonly contextService: ContextService,
  ) {}

  // What a worker found in a run's output. A question already open on the same task is not added again (a re-run
  // usually asks the same thing); one that was ticked off and comes back is added as new.
  async addFromRun(
    jobId: number,
    userId: number,
    texts: string[],
  ): Promise<number> {
    const job = await this.jobRepository.findOne({
      where: { id: jobId, userId },
      select: { id: true, taskKey: true },
    });

    if (!job) throw new NotFoundException('Job not found');
    // Older jobs have no task key; they have nothing to group their questions under.
    if (!job.taskKey) return 0;

    const open = await this.questionRepository
      .createQueryBuilder('q')
      .where('q."userId" = :userId AND q."taskKey" = :taskKey', {
        userId,
        taskKey: job.taskKey,
      })
      .andWhere('q."resolvedAt" IS NULL')
      .getMany();

    const fresh: string[] = [];

    for (const raw of texts.slice(0, MAX_QUESTIONS_PER_REPORT)) {
      const text = normalize(raw).slice(0, MAX_QUESTION_LENGTH);

      if (
        text &&
        !open.some((q) => sameQuestion(q.text, text)) &&
        !fresh.some((t) => sameQuestion(t, text))
      ) {
        fresh.push(text);
      }
    }

    if (fresh.length === 0) return 0;

    await this.questionRepository.save(
      fresh.map((text) => ({
        userId,
        jobId,
        taskKey: job.taskKey as string,
        project: projectOf(job.taskKey as string),
        text,
        resolvedAt: null,
      })),
    );

    return fresh.length;
  }

  // Cards of one kind: with something still open, or fully resolved (the archive). Newest activity first.
  async listCards(
    userId: number,
    archived: boolean,
  ): Promise<QuestionCardDto[]> {
    const rows = await this.questionRepository.find({
      where: { userId },
      order: { id: 'DESC' },
      take: MAX_QUESTIONS_LISTED,
    });

    const byTask = new Map<string, TaskQuestion[]>();

    for (const row of rows) {
      byTask.set(row.taskKey, [...(byTask.get(row.taskKey) ?? []), row]);
    }

    const cards: QuestionCardDto[] = [];

    for (const [taskKey, questions] of byTask) {
      const openCount = questions.filter((q) => q.resolvedAt === null).length;

      if ((openCount === 0) !== archived) continue;

      const ordered = [...questions].sort((a, b) => a.id - b.id);

      cards.push({
        taskKey,
        project: questions[0].project,
        questions: ordered.map((q) => ({
          id: q.id,
          text: q.text,
          resolved: q.resolvedAt !== null,
          answer: q.answer ?? null,
          jobId: q.jobId ?? null,
          createdAt: q.createdAt,
        })),
        openCount,
        archived: openCount === 0,
        updatedAt: new Date(
          Math.max(...questions.map((q) => q.updatedAt.getTime())),
        ),
      });
    }

    return cards.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  // `resolved` ticks a question off or back on; a non-empty `answer` is stored and resolves it, an empty one clears it.
  async setResolved(
    id: number,
    userId: number,
    resolved?: boolean,
    answer?: string,
  ): Promise<TaskQuestion> {
    const question = await this.questionRepository.findOne({
      where: { id, userId },
    });

    if (!question) throw new NotFoundException('Question not found');

    if (resolved === undefined && answer === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    if (answer !== undefined) {
      const trimmed = answer.trim();

      question.answer = trimmed || null;
      if (trimmed && resolved === undefined) resolved = true;
    }

    if (resolved !== undefined) {
      question.resolvedAt = resolved
        ? (question.resolvedAt ?? new Date())
        : null;
    }

    return this.questionRepository.save(question);
  }

  // The answered questions as "Вопрос / Ответ" text.
  buildContextText(questions: Pick<TaskQuestion, 'text' | 'answer'>[]): string {
    return questions
      .filter((q) => q.answer)
      .map((q) => `Вопрос: ${q.text}\nОтвет: ${q.answer}`)
      .join('\n\n')
      .slice(0, MAX_CONTEXT_LENGTH);
  }

  // Saves a card's answers as a Context to attach to the task's next run; a context
  // saved earlier for the card is updated in place (jobs keep their own snapshot).
  async createContext(
    userId: number,
    taskKey: string,
  ): Promise<{ contextId: number; updated: boolean }> {
    const rows = await this.questionRepository.find({
      where: { userId, taskKey },
      order: { id: 'ASC' },
    });
    const content = this.buildContextText(rows);

    if (!content) throw new NotFoundException('No answered questions');

    const name = `Ответы: ${taskKey}`;
    const existing = await this.contextService.findByName(userId, name);

    if (existing) {
      const context = await this.contextService.update(existing.id, userId, {
        content,
      });

      return { contextId: context.id, updated: true };
    }

    const context = await this.contextService.create(userId, { name, content });

    return { contextId: context.id, updated: false };
  }
}
