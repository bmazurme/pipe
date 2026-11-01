import { classifierPrompt, parseClassification } from './router-classifier';
import {
  chooseRoute,
  DEFAULT_SETTINGS,
  keywordsOf,
  matchRule,
  type RouterRule,
  type RouterSettings,
  validateSettings,
} from './router-policy';

const rule = (over: Partial<RouterRule> = {}): RouterRule => ({
  name: 'AliExpress',
  keywords: 'aliexpress, алиэкспресс',
  model: 'opus',
  enabled: true,
  ...over,
});

const settings = (over: Partial<RouterSettings> = {}): RouterSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

describe('keywords and rules', () => {
  it('splits on commas and lines, lower-cases, drops blanks', () => {
    expect(keywordsOf(' AliExpress ,\n  Алиэкспресс\n\n,')).toEqual([
      'aliexpress',
      'алиэкспресс',
    ]);
  });

  it('matches a keyword anywhere in the task, in any case, for the first enabled rule only', () => {
    const rules = [
      rule({ name: 'off', enabled: false }),
      rule({ name: 'second', keywords: 'товар' }),
      rule(),
    ];

    expect(matchRule('Найди ТОВАР на сайте', rules)?.name).toBe('second');
    expect(matchRule('check AliExpress prices', rules)?.name).toBe(
      'AliExpress',
    );
    expect(matchRule('refactor the parser', rules)).toBeNull();
    expect(matchRule('aliexpress', [rule({ enabled: false })])).toBeNull();
  });
});

describe('chooseRoute', () => {
  const small = { tier: 1 as const, needsGenerated: false };

  it('sends a task by its size to the model of its tier', () => {
    const route = chooseRoute({
      task: 'fix a typo',
      executor: 'any',
      classification: small,
      settings: settings(),
    });

    expect(route).toMatchObject({
      model: 'haiku',
      source: 'classifier',
      tier: 1,
    });
    expect(route.reason).toBe('Ярус 1 из 4 — haiku');
    expect(
      chooseRoute({
        task: 't',
        executor: 'any',
        classification: { tier: 3, needsGenerated: false },
        settings: settings(),
      }).model,
    ).toBe('sonnet');
    expect(
      chooseRoute({
        task: 't',
        executor: 'any',
        classification: { tier: 4, needsGenerated: false },
        settings: settings(),
      }).model,
    ).toBe('opus');
  });

  it("uses the owner's model for a tier, a stored custom key included", () => {
    const own = settings({
      tierModels: { 1: 'custom:7', 2: 'deepseek', 3: 'sonnet', 4: 'opus' },
    });

    expect(
      chooseRoute({
        task: 't',
        executor: 'any',
        classification: small,
        settings: own,
      }).model,
    ).toBe('custom:7');
    expect(
      chooseRoute({
        task: 't',
        executor: 'any',
        classification: { tier: 2, needsGenerated: false },
        settings: own,
      }).model,
    ).toBe('deepseek');
  });

  it('a rule beats the size, and the reason names the rule', () => {
    const route = chooseRoute({
      task: 'Найди товар на AliExpress',
      executor: 'any',
      classification: small,
      settings: settings({ rules: [rule()] }),
    });

    expect(route).toMatchObject({
      model: 'opus',
      source: 'rule',
      rule: 'AliExpress',
    });
    expect(route.reason).toContain('Правило «AliExpress»');
  });

  it('does not ask for a size when a rule decided (and so works with no classification)', () => {
    expect(
      chooseRoute({
        task: 'aliexpress',
        executor: 'any',
        classification: null,
        settings: settings({ rules: [rule()] }),
      }).source,
    ).toBe('rule');
  });

  it('falls back to Sonnet, and says why, when the size is unknown', () => {
    const route = chooseRoute({
      task: 'fix',
      executor: 'any',
      classification: null,
      settings: settings(),
    });

    expect(route).toMatchObject({ model: 'sonnet', source: 'fallback' });
    expect(route.reason).toContain('определить не удалось');
  });

  it('a task that has to generate files or a migration does not go to a model with no shell', () => {
    const own = settings({
      tierModels: { 1: 'custom:7', 2: 'custom:7', 3: 'sonnet', 4: 'opus' },
    });
    const route = chooseRoute({
      task: 't',
      executor: 'any',
      classification: { tier: 1, needsGenerated: true },
      settings: own,
    });

    expect(route.model).toBe('sonnet');
    expect(route.reason).toContain('вместо своя модель');
    // Claude models can: the tier's model stays
    expect(
      chooseRoute({
        task: 't',
        executor: 'any',
        classification: { tier: 1, needsGenerated: true },
        settings: settings(),
      }).model,
    ).toBe('haiku');
  });

  it('Fusion needs a Claude model whatever a rule or a tier says', () => {
    const own = settings({
      tierModels: {
        1: 'deepseek',
        2: 'deepseek',
        3: 'deepseek',
        4: 'deepseek',
      },
      rules: [rule({ keywords: 'корпус', model: 'qwen', name: 'Корпус' })],
    });

    expect(
      chooseRoute({
        task: 't',
        executor: 'fusion',
        classification: small,
        settings: own,
      }),
    ).toMatchObject({ model: 'sonnet', source: 'classifier' });
    const ruled = chooseRoute({
      task: 'Построй корпус',
      executor: 'fusion',
      classification: null,
      settings: own,
    });

    expect(ruled).toMatchObject({ model: 'sonnet', source: 'rule' });
    expect(ruled.reason).toContain('не умеет выполнять команды');
    expect(
      chooseRoute({
        task: 'x',
        executor: 'fusion',
        classification: null,
        settings: settings(),
      }).model,
    ).toBe('sonnet');
  });
});

describe('validateSettings', () => {
  const known = (model: string) =>
    ['haiku', 'sonnet', 'opus', 'custom:7'].includes(model);

  it('accepts the defaults and a well-formed rule', () => {
    expect(validateSettings(DEFAULT_SETTINGS, known)).toBeNull();
    expect(
      validateSettings(settings({ rules: [rule({ model: 'sonnet' })] }), known),
    ).toBeNull();
  });

  it('names what is wrong', () => {
    expect(
      validateSettings(
        settings({
          tierModels: { ...DEFAULT_SETTINGS.tierModels, 2: 'gemini' },
        }),
        known,
      ),
    ).toBe('Ярус 2: неизвестная модель «gemini»');
    expect(
      validateSettings(settings({ rules: [rule({ name: ' ' })] }), known),
    ).toBe('У правила нет названия');
    expect(
      validateSettings(settings({ rules: [rule({ keywords: ' , ' })] }), known),
    ).toContain('нет ключевых слов');
    expect(
      validateSettings(settings({ rules: [rule({ model: 'x' })] }), known),
    ).toContain('неизвестная модель «x»');
    expect(
      validateSettings(
        settings({
          rules: Array.from({ length: 21 }, () => rule({ model: 'sonnet' })),
        }),
        known,
      ),
    ).toBe('Правил не больше 20');
  });
});

describe('the classifier prompt and its answer', () => {
  it('carries the task, asks for one line of JSON, and cuts a huge body', () => {
    const prompt = classifierPrompt({ title: 'T', body: 'x'.repeat(10_000) });

    expect(prompt).toContain('TASK TITLE: T');
    expect(prompt).toContain('one line of JSON');
    expect(prompt.length).toBeLessThan(6000);
  });

  it('takes the JSON out of a chatty answer and refuses anything unusable', () => {
    expect(
      parseClassification('Sure: {"tier": 2, "needsGenerated": false}'),
    ).toEqual({ tier: 2, needsGenerated: false });
    expect(
      parseClassification('```json\n{"tier":"3","needsGenerated":true}\n```'),
    ).toEqual({ tier: 3, needsGenerated: true });

    for (const text of [
      '',
      'no json',
      '{"tier": 7}',
      '{"tier": 0}',
      '{"tier": 1.5}',
      '{bad',
      null,
      undefined,
    ]) {
      expect(parseClassification(text)).toBeNull();
    }
  });
});
