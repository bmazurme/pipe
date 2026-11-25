import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { lineDiff, MAX_DIFF_LINES, readSourceText } from './resultFiles';

const render = (d: ReturnType<typeof lineDiff>) => d?.map((l) => `${l.kind}${l.text}`);

describe('lineDiff', () => {
  it('handles insert, delete and replace', () => {
    expect(render(lineDiff('a\nb', 'a\nx\nb'))).toEqual([' a', '+x', ' b']);
    expect(render(lineDiff('a\nx\nb', 'a\nb'))).toEqual([' a', '-x', ' b']);
    expect(render(lineDiff('a\nold\nb', 'a\nnew\nb'))).toEqual([' a', '-old', '+new', ' b']);
  });

  it('collapses long unchanged runs to 3 lines of context', () => {
    const body = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const d = render(lineDiff([...body, 'old', ...body].join('\n'), [...body, 'new', ...body].join('\n')));

    expect(d).toEqual([' …', ' l17', ' l18', ' l19', '-old', '+new', ' l0', ' l1', ' l2', ' …']);
  });

  it('returns null above the line cap', () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `${i}`).join('\n');

    expect(lineDiff(big, 'x')).toBeNull();
    expect(lineDiff('x', big)).toBeNull();
  });

  it('readSourceText applies the same binary rule', () => {
    const z = zipSync({ 'a.txt': strToU8('hi'), 'b.bin': new Uint8Array([0, 1]) });

    expect(readSourceText(z, 'a.txt')).toBe('hi');
    expect(readSourceText(z, 'b.bin')).toBeNull();
  });
});
