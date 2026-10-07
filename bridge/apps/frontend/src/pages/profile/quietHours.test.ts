import { describe, expect, it } from 'vitest';

import { DEFAULT_FORM, formatQuietHours, parseQuietHours, validateQuietHours } from './quietHours';

describe('quiet hours form helpers', () => {
  it('parses a window and pads one-digit hours', () => {
    expect(parseQuietHours('23:00-08:00')).toEqual({ enabled: true, from: '23:00', to: '08:00' });
    expect(parseQuietHours('9:30-18:05')).toEqual({ enabled: true, from: '09:30', to: '18:05' });
  });

  it('parses "off" as disabled, keeping default times for re-enabling', () => {
    expect(parseQuietHours('off')).toEqual({ ...DEFAULT_FORM, enabled: false });
    expect(parseQuietHours(' OFF ')).toEqual({ ...DEFAULT_FORM, enabled: false });
  });

  it('falls back to the default for anything unparseable', () => {
    expect(parseQuietHours('night')).toEqual(DEFAULT_FORM);
  });

  it('formats back to the API shape', () => {
    expect(formatQuietHours({ enabled: true, from: '22:15', to: '07:00' })).toBe('22:15-07:00');
    expect(formatQuietHours({ enabled: false, from: '22:15', to: '07:00' })).toBe('off');
  });

  it('validates the form', () => {
    expect(validateQuietHours(DEFAULT_FORM)).toBeNull();
    expect(validateQuietHours({ enabled: false, from: '', to: '' })).toBeNull();
    expect(validateQuietHours({ enabled: true, from: '', to: '08:00' })).toMatch(/ЧЧ:ММ/);
    expect(validateQuietHours({ enabled: true, from: '24:00', to: '08:00' })).toMatch(/ЧЧ:ММ/);
    expect(validateQuietHours({ enabled: true, from: '08:00', to: '08:00' })).toMatch(/совпадать/);
  });
});
