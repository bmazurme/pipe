import { Injectable } from '@nestjs/common';

import { RouterClassifierService } from './router-classifier.service';
import {
  AUTO_MODEL,
  chooseRoute,
  matchRule,
  type Routing,
} from './router-policy';
import { RouterSettingsService } from './router-settings.service';

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
      : await this.classifier.classify(userId, { title, body: task });

    return chooseRoute({ task, executor, classification, settings });
  }
}
