// "23:00-08:00" <-> the pieces the profile form edits. Kept out of the component
// so the (easy to get subtly wrong) string handling is unit-tested.

export interface QuietHoursForm {
  enabled: boolean;
  from: string; // "HH:MM"
  to: string; // "HH:MM"
}

export const DEFAULT_FORM: QuietHoursForm = { enabled: true, from: '23:00', to: '08:00' };

const PATTERN = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function pad(hours: string, minutes: string): string {
  return `${hours.padStart(2, '0')}:${minutes}`;
}

export function parseQuietHours(value: string): QuietHoursForm {
  if (value.trim().toLowerCase() === 'off') {
    return { ...DEFAULT_FORM, enabled: false };
  }

  const match = PATTERN.exec(value.trim());

  return match
    ? { enabled: true, from: pad(match[1], match[2]), to: pad(match[3], match[4]) }
    : DEFAULT_FORM;
}

export function formatQuietHours(form: QuietHoursForm): string {
  return form.enabled ? `${form.from}-${form.to}` : 'off';
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Returns an error message, or null when the form can be saved. */
export function validateQuietHours(form: QuietHoursForm): string | null {
  if (!form.enabled) return null;
  if (!TIME.test(form.from) || !TIME.test(form.to)) return 'Укажите время в формате ЧЧ:ММ';
  if (form.from === form.to) return 'Начало и конец не могут совпадать';

  return null;
}
