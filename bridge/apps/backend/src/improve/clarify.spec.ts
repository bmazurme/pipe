import {
  allAnswered,
  CLARIFY_MODEL,
  clarificationsSection,
  clarifyPrompt,
  MAX_BLOCKING_QUESTIONS,
  parseClarifyMode,
  shouldClarify,
} from './clarify';

describe('shouldClarify', () => {
  it('never when it is off, or for nothing set', () => {
    expect(shouldClarify('off', 'opus', 'manual')).toBe(false);
    expect(shouldClarify(null, 'opus', 'manual')).toBe(false);
    expect(shouldClarify(undefined, 'opus', 'schedule')).toBe(false);
  });

  it('«costly»: a run on a model chosen by name that is not Haiku — not Haiku itself, not «auto»', () => {
    expect(shouldClarify('costly', 'sonnet', 'manual')).toBe(true);
    expect(shouldClarify('costly', 'opus', 'schedule')).toBe(true);
    expect(shouldClarify('costly', 'gpt', 'manual')).toBe(true);
    expect(shouldClarify('costly', CLARIFY_MODEL, 'manual')).toBe(false);
    expect(shouldClarify('costly', 'auto', 'manual')).toBe(false);
  });

  it('«always»: every run somebody started', () => {
    for (const model of ['haiku', 'auto', 'sonnet'])
      expect(shouldClarify('always', model, 'manual')).toBe(true);
  });

  it('never for work that continues what was already understood: a CI repair, a chat fix, a conflict redo', () => {
    for (const trigger of ['ci', 'chat', 'conflict'] as const)
      expect(shouldClarify('always', 'opus', trigger)).toBe(false);
  });
});

describe('parseClarifyMode', () => {
  it('knows the three, and falls back to off for anything else', () => {
    expect(['off', 'costly', 'always'].map(parseClarifyMode)).toEqual([
      'off',
      'costly',
      'always',
    ]);
    for (const bad of ['sometimes', '', null, undefined, 3])
      expect(parseClarifyMode(bad)).toBe('off');
  });
});

describe('clarifyPrompt', () => {
  const prompt = clarifyPrompt({
    number: 12,
    title: 'Add export',
    body: 'Export the report.',
  });

  it('says not to change anything and not to start the work', () => {
    expect(prompt).toContain('Do NOT change any file');
    expect(prompt).toContain('do NOT start the work');
  });

  it('asks only for blocking questions, bounded, and says what not to ask', () => {
    expect(prompt).toContain(`at most ${MAX_BLOCKING_QUESTIONS}`);
    expect(prompt).toContain('BLOCKING');
    expect(prompt).toContain(
      'what the repository or CLAUDE.md already answers',
    );
    expect(prompt).toContain('there is nothing to ask');
  });

  it('carries the task itself, after the instructions', () => {
    expect(prompt).toContain('issue #12: Add export');
    expect(prompt.indexOf('Export the report.')).toBeGreaterThan(
      prompt.indexOf('there is nothing to ask'),
    );
  });

  it('copes with a task that has no text', () => {
    expect(clarifyPrompt({ number: 1, title: 't', body: '  ' })).toContain(
      '(the task has no description)',
    );
  });
});

describe('answers', () => {
  it('are complete when every question has an answer that is not blank — and never for no questions', () => {
    expect(
      allAnswered([
        { text: 'a?', answer: 'yes' },
        { text: 'b?', answer: 'no' },
      ]),
    ).toBe(true);
    expect(
      allAnswered([
        { text: 'a?', answer: 'yes' },
        { text: 'b?', answer: null },
      ]),
    ).toBe(false);
    expect(allAnswered([{ text: 'a?', answer: '   ' }])).toBe(false);
    expect(allAnswered([])).toBe(false);
  });

  it('go into the task as question and answer, and say when one was left open', () => {
    const section = clarificationsSection([
      { text: 'CSV or XLSX?', answer: ' CSV ' },
      { text: 'Which period?', answer: null },
    ]);

    expect(section).toContain("## The owner's answers");
    expect(section).toContain('- Q: CSV or XLSX?\n  A: CSV');
    expect(section).toContain(
      '- Q: Which period?\n  A: (no answer — decide yourself, and say in the pull request which assumption you made)',
    );
  });

  it('are nothing for no questions', () => {
    expect(clarificationsSection([])).toBe('');
  });
});
