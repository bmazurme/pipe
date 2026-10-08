import { describe, expect, it } from 'vitest';

import { blocksNewRun, describeSchedule, formatTime, isActiveRun, parseTime } from './improveLabels';

describe('improve labels', () => {
  it('describes a schedule in words, with the right Russian plural', () => {
    const base = { hour: 2, minute: 0, timezone: 'Europe/Moscow', model: 'sonnet' };

    expect(describeSchedule({ ...base, count: 5 })).toBe('каждый день в 02:00 (Europe/Moscow) · 5 задач · Claude Sonnet');
    expect(describeSchedule({ ...base, count: 1 })).toContain('1 задача');
    expect(describeSchedule({ ...base, count: 3 })).toContain('3 задачи');
    expect(describeSchedule({ ...base, count: 11 })).toContain('11 задач');
    expect(describeSchedule({ ...base, count: 21 })).toContain('21 задача');
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

  it('names the first problem', async () => {
    const { validateScheduleForm } = await import('./improveLabels');

    expect(validateScheduleForm({ ...form, name: ' ' })).toBe('Укажите название');
    expect(validateScheduleForm({ ...form, time: '25:00' })).toMatch(/ЧЧ:ММ/);
    expect(validateScheduleForm({ ...form, count: '0' })).toMatch(/от 1 до 20/);
    expect(validateScheduleForm({ ...form, count: '2.5' })).toMatch(/от 1 до 20/);
  });
});
