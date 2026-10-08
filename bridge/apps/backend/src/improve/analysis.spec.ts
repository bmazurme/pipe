import { PROTECTED_PATHS } from '../loop/protected-paths';
import {
  ALL_CATEGORIES,
  BACKLOG_FILE,
  buildAnalysisPrompt,
  issueBody,
  normalizeTitle,
  parseBacklog,
  pickOnePerCategory,
} from './analysis';

const item = (category: string, title = `t-${category}`) => ({
  category,
  title,
  risk: 'low',
  body: `## Problem\n${category}`,
});

describe('buildAnalysisPrompt', () => {
  it('asks for exactly one item per direction and names every direction id', () => {
    const prompt = buildAnalysisPrompt([]);

    expect(prompt).toContain(`exactly ${ALL_CATEGORIES.length} small`);
    expect(ALL_CATEGORIES).toEqual(expect.arrayContaining(['tests', 'docs']));
    for (const id of ALL_CATEGORIES) expect(prompt).toContain(`"${id}"`);
    expect(prompt).toContain(BACKLOG_FILE);
  });

  it('gives the tests and docs directions their own guidance', () => {
    const prompt = buildAnalysisPrompt([], ['tests', 'docs']);

    expect(prompt).toContain('exactly 2 small');
    expect(prompt).toContain('testing gap');
    expect(prompt).toContain('documentation gap');
  });

  it('can be limited to some directions', () => {
    const prompt = buildAnalysisPrompt([], ['uiux', 'security']);

    expect(prompt).toContain('exactly 2 small');
    expect(prompt).toContain('"uiux"');
    expect(prompt).not.toContain('"performance"');
  });

  it('lists the protected paths and what was already proposed', () => {
    const prompt = buildAnalysisPrompt(['Existing thing']);

    expect(prompt).toContain('- Existing thing');
    expect(PROTECTED_PATHS.every((path) => prompt.includes(path))).toBe(true);
  });
});

describe('parseBacklog', () => {
  it('keeps valid items and clamps risk, title and body', () => {
    const items = parseBacklog(
      JSON.stringify({
        items: [
          {
            category: 'security',
            title: `  ${'x'.repeat(300)} `,
            body: 'y'.repeat(9000),
            risk: 'nonsense',
          },
        ],
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toHaveLength(120);
    expect(items[0].body).toHaveLength(4000);
    expect(items[0].risk).toBe('medium');
  });

  it('drops items with an unknown category or missing fields without failing the read', () => {
    const items = parseBacklog(
      JSON.stringify({
        items: [
          item('uiux'),
          item('astrology'),
          { category: 'general', title: '', body: 'b' },
          null,
          { category: 'general', title: 't' },
        ],
      }),
    );

    expect(items.map((i) => i.category)).toEqual(['uiux']);
  });

  it('rejects text that is not the expected JSON', () => {
    expect(() => parseBacklog('not json')).toThrow(/корректным JSON/);
    expect(() => parseBacklog('{"things":[]}')).toThrow(/нет массива items/);
  });
});

describe('pickOnePerCategory', () => {
  it('takes the first item of each requested direction, in direction order, ignoring extras', () => {
    const picked = pickOnePerCategory(
      [
        item('security', 'first'),
        item('uiux'),
        item('security', 'second'),
        item('performance'),
      ].map((i) => ({
        ...i,
        category: i.category as never,
        risk: 'low' as const,
      })),
    );

    expect(picked.map((i) => `${i.category}:${i.title}`)).toEqual([
      'uiux:t-uiux',
      'security:first',
      'performance:t-performance',
    ]);
  });

  it('leaves out a direction the analysis had nothing for', () => {
    expect(pickOnePerCategory([], ['general'])).toEqual([]);
  });
});

describe('helpers', () => {
  it('normalizes titles for duplicate detection', () => {
    expect(normalizeTitle('  Fix   THE Thing ')).toBe('fix the thing');
  });

  it('labels the issue body with its direction and risk', () => {
    expect(
      issueBody({ category: 'uiux', title: 't', risk: 'high', body: 'BODY' }),
    ).toContain('**UI/UX** · риск: high');
  });
});
