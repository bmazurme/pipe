import { describe, expect, it } from 'vitest';

import { blocksNewRun, describeSchedule, formatTime, isActiveRun, parseTime, readStoredModel, RUN_STATUS_LABEL, storeModel } from './improveLabels';

describe('improve labels', () => {
  it('describes a schedule in words, with the right Russian plural', () => {
    const base = { hour: 2, minute: 0, timezone: 'Europe/Moscow', model: 'sonnet' };

    expect(describeSchedule({ ...base, count: 5 })).toBe('каждый день в 02:00 (Europe/Moscow) · 5 задач · Claude Sonnet');
    expect(describeSchedule({ ...base, count: 1 })).toContain('1 задача');
    expect(describeSchedule({ ...base, count: 3 })).toContain('3 задачи');
    expect(describeSchedule({ ...base, count: 11 })).toContain('11 задач');
    expect(describeSchedule({ ...base, count: 21 })).toContain('21 задача');
  });

  it('names the analysis directions of a schedule, including new features when they are chosen', () => {
    const base = { hour: 2, minute: 0, timezone: 'UTC', model: 'sonnet', count: 5, kind: 'analysis' as const };

    // never chose directions = the improvement directions, no features
    expect(describeSchedule({ ...base, categories: null })).toContain('анализ: 5 направлений');
    expect(describeSchedule({ ...base, categories: 'tests,features' })).toContain('анализ: Тесты, Новые фичи');
    expect(describeSchedule({ ...base, categories: 'general,uiux,security,performance,reliability,tests,docs,architecture,features' })).toContain('Новые фичи');
    // the five improvement directions plus refactoring are no longer "the default 5"
    expect(describeSchedule({ ...base, categories: 'general,uiux,security,performance,reliability,tests,docs,architecture,refactoring' })).toContain('Рефакторинг');
    expect(describeSchedule({ ...base, categories: 'refactoring' })).toContain('анализ: Рефакторинг');
  });

  it('formats and parses times', () => {
    expect(formatTime(2, 5)).toBe('02:05');
    expect(parseTime('02:05')).toEqual({ hour: 2, minute: 5 });
    expect(parseTime('9:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('noon')).toBeNull();
  });

  it('treats working and open-PR runs as blocking a new start', () => {
    expect(isActiveRun({ status: 'running' })).toBe(true);
    expect(isActiveRun({ status: 'failed' })).toBe(false);
    expect(blocksNewRun({ status: 'pr_open' })).toBe(true);
    // a CI repair that pushed its fix leaves the PR open too
    expect(blocksNewRun({ status: 'pr_updated' })).toBe(true);
    expect(blocksNewRun({ status: 'failed' })).toBe(false);
    expect(blocksNewRun(null)).toBe(false);
  });
});

describe('validateScheduleForm', () => {
  const form = { name: ' Ночной ', enabled: true, time: '02:00', timezone: 'UTC', count: '5', model: 'sonnet' };

  it('turns a valid form into the API input', async () => {
    const { validateScheduleForm } = await import('./improveLabels');

    expect(validateScheduleForm(form)).toEqual({ name: 'Ночной', enabled: true, hour: 2, minute: 0, timezone: 'UTC', count: 5, model: 'sonnet' });
  });

  it('carries a chosen context, or null when it was cleared, and nothing when untouched', async () => {
    const { validateScheduleForm, ALL_CATEGORIES } = await import('./improveLabels');

    expect(validateScheduleForm({ ...form, contextId: '4' })).toMatchObject({ contextId: 4 });
    expect(validateScheduleForm({ ...form, contextId: '' })).toMatchObject({ contextId: null });
    expect(validateScheduleForm({ ...form })).not.toHaveProperty('contextId');
    expect(validateScheduleForm({ ...form, kind: 'analysis', categories: ALL_CATEGORIES.slice(0, 1), contextId: '3' })).toMatchObject({ kind: 'analysis', contextId: 3 });
  });

  it('names the first problem', async () => {
    const { validateScheduleForm } = await import('./improveLabels');

    expect(validateScheduleForm({ ...form, name: ' ' })).toBe('Укажите название');
    expect(validateScheduleForm({ ...form, time: '25:00' })).toMatch(/ЧЧ:ММ/);
    expect(validateScheduleForm({ ...form, count: '0' })).toMatch(/от 1 до 20/);
    expect(validateScheduleForm({ ...form, count: '2.5' })).toMatch(/от 1 до 20/);
  });
});

describe('a preparing run', () => {
  it('is labelled, active and blocks a new run', () => {
    expect(RUN_STATUS_LABEL.preparing).toBe('Готовится');
    expect(isActiveRun({ status: 'preparing' })).toBe(true);
    expect(blocksNewRun({ status: 'preparing' })).toBe(true);
  });
});

describe('the remembered model', () => {
  it("remembers a named model and one of the owner's own keys, 'auto' only where it is offered, and falls back to Sonnet", () => {
    storeModel('opus');
    expect(readStoredModel()).toBe('opus');

    storeModel('custom:12');
    expect(readStoredModel()).toBe('custom:12');

    storeModel('auto');
    expect(readStoredModel(true)).toBe('auto');
    expect(readStoredModel()).toBe('sonnet');

    for (const junk of ['custom', 'custom:', 'gemini', '']) {
      storeModel(junk);
      expect(readStoredModel(true)).toBe('sonnet');
    }
  });

  it("names 'auto' schedules by the router's label when given one", () => {
    const base = { hour: 2, minute: 0, timezone: 'UTC', count: 2 };

    expect(describeSchedule({ ...base, model: 'auto' }, () => 'Авто')).toContain('· Авто');
  });
});
