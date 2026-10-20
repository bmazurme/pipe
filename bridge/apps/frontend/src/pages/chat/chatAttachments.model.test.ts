import { describe, expect, it } from 'vitest';

import { MODEL_OPTIONS } from '../worker/constants';
import { isClaudeModel } from './chatAttachments';

describe('the models on offer', () => {
  it('lists Haiku with the other Claude models, in a job and for a chat', () => {
    expect(MODEL_OPTIONS.map((option) => option.value)).toEqual(['sonnet', 'opus', 'haiku', 'gpt', 'deepseek', 'qwen']);
    expect(MODEL_OPTIONS.find((option) => option.value === 'haiku')?.content).toBe('Claude Haiku');
  });

  it('counts every Claude model — and only those — as able to take attachments', () => {
    for (const model of ['sonnet', 'opus', 'haiku']) expect(isClaudeModel(model), model).toBe(true);
    for (const model of ['gpt', 'deepseek', 'qwen', undefined]) expect(isClaudeModel(model), String(model)).toBe(false);
  });
});
