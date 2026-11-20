import { describe, expect, it } from 'vitest';

import { campaignLabel, deviceLabel, langLabel, percent, sectionLabel, shortDay, sourceLabel, targetLabel } from './statsLabels';

describe('statsLabels', () => {
  it('names the usual link targets and keeps unknown hosts as they are', () => {
    expect(targetLabel('t.me')).toBe('Telegram (t.me)');
    expect(targetLabel('example.org')).toBe('example.org');
    expect(targetLabel(null)).toBe('без адреса');
  });

  it('explains an empty referrer, section, language and device', () => {
    expect(sourceLabel(null)).toBe('прямой заход / источник скрыт');
    expect(sourceLabel('google.com')).toBe('google.com');
    expect(sectionLabel(null)).toBe('вне секции');
    expect(sectionLabel('water')).toBe('видео с воды');
    expect(sectionLabel('custom')).toBe('custom');
    expect(langLabel('ru')).toBe('русский');
    expect(langLabel(null)).toBe('не определён');
    expect(deviceLabel('mobile')).toBe('телефон');
  });

  it('joins the campaign tags that are set', () => {
    expect(campaignLabel('telegram', null, 'launch')).toBe('telegram / launch');
    expect(campaignLabel(null, null, null)).toBe('—');
  });

  it('formats a day without letting the time zone move it', () => {
    expect(shortDay('2026-11-20')).toMatch(/20/);
  });

  it('takes a percent of a total, and 0 of nothing', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 0)).toBe(0);
  });
});
