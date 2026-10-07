import { describe, expect, it } from 'vitest';

import { analysisTitle, buildAnalysisPrompt, isAnalysisTitle, markDuplicates, normalizeModule, parseBacklog, PROTECTED_PATHS } from './analysis';

describe('analysis titles', () => {
  it('builds and recognizes an analysis task title', () => {
    expect(analysisTitle(new Date('2026-10-06T12:00:00Z'))).toBe('Analysis 2026-10-06');
    expect(isAnalysisTitle('Analysis 2026-10-06')).toBe(true);
    expect(isAnalysisTitle('docs: fix')).toBe(false);
    expect(isAnalysisTitle(undefined)).toBe(false);
  });
});

describe('buildAnalysisPrompt', () => {
  it('lists existing proposals so they are not repeated, and every protected path', () => {
    const prompt = buildAnalysisPrompt(['Add retry to X', 'Fix Y']);

    expect(prompt).toContain('- Add retry to X');
    expect(prompt).toContain('- Fix Y');

    for (const path of PROTECTED_PATHS) expect(prompt).toContain(path);
  });

  it('says so when nothing was proposed before', () => {
    expect(buildAnalysisPrompt([])).toContain('(none yet)');
  });

  it('forbids touching existing files and names the output file', () => {
    const prompt = buildAnalysisPrompt([]);

    expect(prompt).toContain('Do NOT change any existing file');
    expect(prompt).toContain('loop-backlog.json');
  });
});

describe('parseBacklog', () => {
  it('parses valid items and defaults an unknown risk to medium', () => {
    const items = parseBacklog(JSON.stringify({ items: [{ title: ' Add test ', body: '## Problem', risk: 'low' }, { title: 'B', body: 'b', risk: 'wild' }] }));

    expect(items).toEqual([
      { title: 'Add test', body: '## Problem', risk: 'low' },
      { title: 'B', body: 'b', risk: 'medium' },
    ]);
  });

  it('drops malformed items instead of failing the whole read', () => {
    const items = parseBacklog(JSON.stringify({ items: [null, { title: 5, body: 'x' }, { title: 'ok', body: '' }, { title: 'good', body: 'b' }] }));

    expect(items.map((item) => item.title)).toEqual(['good']);
  });

  it('caps the count and clamps title length', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `T${i}`.padEnd(300, 'x'), body: 'b' }));
    const items = parseBacklog(JSON.stringify({ items: many }));

    expect(items).toHaveLength(5);
    expect(items[0].title.length).toBe(120);
  });

  it('rejects non-JSON and a missing items array', () => {
    expect(() => parseBacklog('not json')).toThrow(/JSON/);
    expect(() => parseBacklog('{"things":[]}')).toThrow(/items/);
  });

  it('accepts an empty backlog', () => {
    expect(parseBacklog('{"items": []}')).toEqual([]);
  });
});

describe('markDuplicates', () => {
  it('flags a title matching an existing issue, ignoring case and spacing', () => {
    const marked = markDuplicates(
      [{ title: 'Add  Retry to X', body: 'b', risk: 'low' }, { title: 'Brand new', body: 'b', risk: 'low' }],
      [{ number: 7, title: 'add retry to x' }],
    );

    expect(marked[0].duplicateOf).toBe(7);
    expect(marked[1].duplicateOf).toBeUndefined();
  });
});

describe('analysis kind and module', () => {
  const date = new Date('2026-10-07T10:00:00Z');

  it('keeps the original title and prompt for a general whole-repo analysis', () => {
    expect(analysisTitle(date)).toBe('Analysis 2026-10-07');
    expect(buildAnalysisPrompt([])).not.toContain('Scope:');
    expect(buildAnalysisPrompt([])).not.toContain('Focus on');
  });

  it('puts the kind and module in the title, which still reads as an analysis task', () => {
    const title = analysisTitle(date, { kind: 'uiux', module: 'bridge/apps/frontend' });

    expect(title).toBe('Analysis 2026-10-07 · UI/UX · bridge/apps/frontend');
    expect(isAnalysisTitle(title)).toBe(true);
  });

  it('adds focus guidance and a scope restriction to the prompt', () => {
    const prompt = buildAnalysisPrompt([], { kind: 'uiux', module: 'reports/packages/client' });

    expect(prompt).toContain('Focus on UI/UX');
    expect(prompt).toContain('review ONLY `reports/packages/client`');
  });

  it('still lists the protected paths and existing titles with a scope set', () => {
    const prompt = buildAnalysisPrompt(['Already proposed'], { kind: 'security', module: 'worker' });

    expect(prompt).toContain('- Already proposed');
    expect(PROTECTED_PATHS.every((path) => prompt.includes(path))).toBe(true);
  });
});

describe('normalizeModule', () => {
  it('treats empty input as the whole repository', () => {
    expect(normalizeModule(undefined)).toBeUndefined();
    expect(normalizeModule('  ')).toBeUndefined();
  });

  it('trims, and strips a leading ./ and trailing slashes', () => {
    expect(normalizeModule(' ./bridge/apps/frontend/ ')).toBe('bridge/apps/frontend');
  });

  it('rejects anything that is not a plain repo-relative path', () => {
    for (const bad of ['../etc', 'a/../b', '/abs/path', 'a b', 'x`y', 'a;rm -rf', 'a\nb']) {
      expect(() => normalizeModule(bad)).toThrow(/Некорректный путь/);
    }
  });
});
