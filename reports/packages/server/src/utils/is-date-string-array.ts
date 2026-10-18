const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDateStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)));
