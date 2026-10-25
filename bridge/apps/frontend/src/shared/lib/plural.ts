/**
 * Picks the Russian plural form for `count`.
 * `forms` is ordered [1 минуту, 2 минуты, 5 минут].
 */
export function plural(count: number, forms: [string, string, string]): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return forms[2];
  }

  const mod10 = count % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}
