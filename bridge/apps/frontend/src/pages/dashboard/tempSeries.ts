import type { BoardSeriesPoint } from '../../store/api';

export interface Segment {
  x: number;
  y: number;
}

// Splits a series where a reading is missing, so a gap is drawn as a gap and not as a line across it.
export function segments(points: BoardSeriesPoint[], pick: 'soc' | 'nvme', x: (time: number) => number, y: (value: number) => number): Segment[][] {
  const out: Segment[][] = [];
  let current: Segment[] = [];

  for (const point of points) {
    const value = point[pick];

    if (value === null) {
      if (current.length) out.push(current);
      current = [];
      continue;
    }
    current.push({ x: x(Date.parse(point.t)), y: y(value) });
  }
  if (current.length) out.push(current);

  return out;
}
