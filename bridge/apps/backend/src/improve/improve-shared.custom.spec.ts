import { BadRequestException } from '@nestjs/common';

import {
  isClaudeModelName,
  jobModelOf,
  requireImproveModel,
} from './improve-shared';

// A run or schedule on a custom model keeps it as "custom:<id of the stored key>" in its ordinary model column.
describe('custom models in Improve and Lab', () => {
  it('accepts the named models and "custom:<key id>", nothing else', () => {
    for (const model of [
      'sonnet',
      'opus',
      'haiku',
      'gpt',
      'deepseek',
      'qwen',
      'custom:7',
      'custom:12',
    ]) {
      expect(() => requireImproveModel(model)).not.toThrow();
    }
    for (const model of [
      'custom',
      'custom:',
      'custom:abc',
      'custom:1:2',
      'Custom:3',
      ' custom:3',
      'gemini',
    ]) {
      expect(() => requireImproveModel(model)).toThrow(BadRequestException);
    }
  });

  it("turns a stored model into the job's model and key", () => {
    expect(jobModelOf('sonnet')).toEqual({ model: 'sonnet' });
    expect(jobModelOf('custom:12')).toEqual({
      model: 'custom',
      providerCredentialId: 12,
    });
  });

  it('knows which models have a shell', () => {
    expect(['sonnet', 'opus', 'haiku'].every(isClaudeModelName)).toBe(true);
    expect(
      ['gpt', 'deepseek', 'qwen', 'custom:3'].some(isClaudeModelName),
    ).toBe(false);
  });
});
