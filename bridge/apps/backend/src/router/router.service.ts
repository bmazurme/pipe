import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { RouterClassifierService } from './router-classifier.service';
import {
  AUTO_MODEL,
  chooseRoute,
  matchRule,
  type Routing,
} from './router-policy';
import { RouterSettingsService } from './router-settings.service';

const CLASSIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLASSIFICATION_CACHE_MAX = 500;

type Classification = Awaited<ReturnType<RouterClassifierService['classify']>>;

export interface RouteRequest {
  userId: number;
  // The model the owner asked for: a real one passes through unchanged, 'auto' is decided here.
  model: string;
  title: string;
  task: string;
  executor: 'any' | 'fusion';
}

@Injectable()
export class RouterService {
  // Insertion-ordered, so the first key is the oldest entry.
  private readonly classifications = new Map<
    string,
    { classification: NonNullable<Classification>; at: number }
  >();

  constructor(
    private readonly settings: RouterSettingsService,
    private readonly classifier: RouterClassifierService,
  ) {}

  // The model a job is made with, and — for 'auto' — why. null routing: nothing was decided (the owner named the model).
  async resolve(
    request: RouteRequest,
  ): Promise<{ model: string; routing: Routing | null }> {
    if (request.model !== AUTO_MODEL)
      return { model: request.model, routing: null };

    const routing = await this.decide(request);

    return { model: routing.model, routing };
  }

  // What 'auto' would pick for this task, without starting anything: the same decision, for the settings page to try out.
  async decide({
    userId,
    title,
    task,
    executor,
  }: Omit<RouteRequest, 'model'>): Promise<Routing> {
    const settings = await this.settings.get(userId);
    // A rule decides by words alone: nobody needs to be asked how big the task is.
    const classification = matchRule(task, settings.rules)
      ? null
      : await this.classify(userId, title, task);

    return chooseRoute({ task, executor, classification, settings });
  }

  // The same task is sized once a week at most: a timeout (null) is never remembered.
  private async classify(
    userId: number,
    title: string,
    task: string,
  ): Promise<Classification> {
    const key = createHash('sha256')
      .update(JSON.stringify([userId, title, task]))
      .digest('hex');
    const cached = this.classifications.get(key);

    if (cached && Date.now() - cached.at < CLASSIFICATION_TTL_MS)
      return cached.classification;

    const classification = await this.classifier.classify(userId, {
      title,
      body: task,
    });

    if (classification) {
      this.classifications.delete(key);
      this.classifications.set(key, { classification, at: Date.now() });

      while (this.classifications.size > CLASSIFICATION_CACHE_MAX)
        this.classifications.delete(
          this.classifications.keys().next().value as string,
        );
    }

    return classification;
  }
}
