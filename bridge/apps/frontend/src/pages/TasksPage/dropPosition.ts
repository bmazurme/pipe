import type { TaskColumn } from '../../store/api';

// Index the dragged card should end up at in `column` when dropped onto the card `beforeCardId`
// (or at the end when null). The server removes the dragged card first, then inserts at this
// index, so the index is counted among the column's other cards.
export function dropPosition(column: TaskColumn, draggedId: number, beforeCardId: number | null): number {
  const others = column.cards.filter((card) => card.id !== draggedId);

  if (beforeCardId === null) return others.length;

  const index = others.findIndex((card) => card.id === beforeCardId);

  return index === -1 ? others.length : index;
}
