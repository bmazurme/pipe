import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { PREPARE_ABANDONED_ERROR, preparingStaleMs } from './improve-shared';

describe('preparingStaleMs', () => {
  it('adds a five minute margin to the download deadline', () => {
    expect(preparingStaleMs(10 * 60_000)).toBe(15 * 60_000);
    expect(PREPARE_ABANDONED_ERROR).toContain('Подготовка прервана');
  });
});

describe('improve/ dependency direction', () => {
  it('does not import from lab/', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? files(p) : [p];
      });
    const offenders = files(__dirname).filter(
      (f) =>
        f.endsWith('.ts') &&
        !f.endsWith('.stale.spec.ts') &&
        /from '\.\.\/lab\//.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
