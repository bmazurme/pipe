import { describe, expect, it } from 'vitest';

import { dropPosition } from './dropPosition';

const card = (id: number) => ({ id, columnId: 1, title: `c${id}`, description: '', position: id, archivedAt: null });
const column = { id: 1, title: 'A', position: 0, cards: [card(1), card(2), card(3)] };

describe('dropPosition', () => {
  it('appends when dropped on the empty area of a column', () => {
    expect(dropPosition(column, 9, null)).toBe(3);
    expect(dropPosition(column, 1, null)).toBe(2);
  });

  it('inserts before the target card, counted without the dragged card', () => {
    expect(dropPosition(column, 9, 2)).toBe(1);
    expect(dropPosition(column, 1, 3)).toBe(1);
    expect(dropPosition(column, 3, 1)).toBe(0);
  });
});
