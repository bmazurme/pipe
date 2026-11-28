import {
  assessCopies,
  assessEncKey,
  assessItem,
  CATALOG,
  type CopyState,
  rotationAlert,
  worst,
} from './rotation';

const NOW = new Date('2026-12-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('assessItem', () => {
  it('asks for the date when nobody has marked one — a warning, not an alarm', () => {
    const result = assessItem(
      { key: 'jwt', intervalDays: 365, lastRotatedAt: null },
      NOW,
    );

    expect(result.status).toBe('warn');
    expect(result.reasons[0]).toMatch(/неизвестно/);
  });

  it('is fine well before the date, warns in the last 30 days, and is bad when overdue', () => {
    const at = (back: number) =>
      assessItem(
        { key: 'jwt', intervalDays: 365, lastRotatedAt: daysAgo(back) },
        NOW,
      );

    expect(at(100).status).toBe('ok');
    expect(at(100).daysLeft).toBe(265);
    expect(at(340)).toMatchObject({ status: 'warn', daysLeft: 25 });
    expect(at(365).status).toBe('warn');
    expect(at(370)).toMatchObject({ status: 'bad', daysLeft: -5 });
    expect(at(370).reasons[0]).toMatch(/просрочена на 5 дн/);
  });

  it('has no date for something on no calendar', () => {
    expect(
      assessItem({ key: 'age-key', intervalDays: 0, lastRotatedAt: null }, NOW),
    ).toMatchObject({ status: 'ok', dueAt: null });
  });
});

const copy = (
  label: string,
  okDaysAgo: number | null,
  extra: Partial<CopyState> = {},
): CopyState => ({
  label,
  lastCheckAt: daysAgo(okDaysAgo ?? 1),
  ok: okDaysAgo !== null,
  lastOkAt: okDaysAgo === null ? null : daysAgo(okDaysAgo),
  error: null,
  ...extra,
});

describe('assessCopies', () => {
  it('says so when no copy was ever tried', () => {
    expect(assessCopies([], NOW)).toMatchObject({
      status: 'warn',
      verified: 0,
    });
  });

  it('wants two verified copies: one is a single point of failure', () => {
    const one = assessCopies([copy('mac', 10)], NOW);

    expect(one).toMatchObject({ status: 'warn', verified: 1 });
    expect(one.reasons[0]).toMatch(/нужно 2/);
    expect(assessCopies([copy('mac', 10), copy('usb', 20)], NOW)).toMatchObject(
      { status: 'ok', verified: 2, reasons: [] },
    );
  });

  it('warns when a copy has not been tried for 150 days, and is bad after 180', () => {
    expect(
      assessCopies([copy('mac', 10), copy('usb', 160)], NOW),
    ).toMatchObject({ status: 'warn', verified: 2 });

    const late = assessCopies([copy('mac', 10), copy('usb', 200)], NOW);

    expect(late.status).toBe('bad');
    expect(late.reasons[0]).toMatch(/«usb» не проверялась 200 дн/);
    expect(late.verified).toBe(1);
  });

  it('a copy that failed today is bad even though it worked before', () => {
    const result = assessCopies(
      [
        copy('mac', 10),
        {
          ...copy('usb', 30),
          ok: false,
          error: 'no identity matched any of the recipients',
          lastCheckAt: daysAgo(0),
        },
      ],
      NOW,
    );

    expect(result.status).toBe('bad');
    expect(result.reasons[0]).toMatch(/«usb» не расшифровала.*no identity/);
  });
});

describe('assessEncKey', () => {
  const base = assessItem(
    { key: 'enc-key', intervalDays: 365, lastRotatedAt: daysAgo(10) },
    NOW,
  );

  it('leaves the verdict alone when nothing is left under an old key (or it could not be counted)', () => {
    expect(assessEncKey(base, 0, 'v1')).toBe(base);
    expect(assessEncKey(base, null, null)).toBe(base);
  });

  it('warns about a rotation that was started and not finished', () => {
    const result = assessEncKey(base, 12, 'v2');

    expect(result.status).toBe('warn');
    expect(result.reasons[0]).toMatch(/12 значений.*v2/);
  });
});

describe('the calendar and the alert', () => {
  it('has every key once, and only the age key off the calendar', () => {
    expect(new Set(CATALOG.map((c) => c.key)).size).toBe(CATALOG.length);
    expect(
      CATALOG.filter((c) => c.intervalDays === 0).map((c) => c.key),
    ).toEqual(['age-key']);
  });

  it('worst picks the worst', () => {
    expect(worst('ok', 'warn')).toBe('warn');
    expect(worst('ok', 'bad', 'warn')).toBe('bad');
    expect(worst('ok')).toBe('ok');
  });

  it('the alert names the item, the first reason and the count of the rest', () => {
    const text = rotationAlert('JWT', ['просрочена', 'второе']);

    expect(text).toContain('JWT: просрочена (и ещё 1)');
    expect(text).toContain('docs/key-rotation.md');
  });
});
