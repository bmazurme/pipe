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

export interface SeriesStats {
  socMin: number | null;
  socMax: number | null;
  nvmeMin: number | null;
  nvmeMax: number | null;
  /** The vertical range of the drawing: the data with a margin, so a flat 48 °C does not hide in a 30–80 frame. */
  lo: number;
  hi: number;
}

const MIN_SPAN = 12;

export function seriesStats(points: BoardSeriesPoint[]): SeriesStats | null {
  const soc = points.map((p) => p.soc).filter((v): v is number => v !== null);
  const nvme = points.map((p) => p.nvme).filter((v): v is number => v !== null);
  const all = [...soc, ...nvme];

  if (all.length === 0) return null;

  const min = Math.min(...all);
  const max = Math.max(...all);
  // At least MIN_SPAN degrees tall, centred on the data, so noise of a degree does not look like a climb.
  const span = Math.max(MIN_SPAN, (max - min) * 1.3);
  const mid = (max + min) / 2;

  return {
    socMin: soc.length ? Math.min(...soc) : null,
    socMax: soc.length ? Math.max(...soc) : null,
    nvmeMin: nvme.length ? Math.min(...nvme) : null,
    nvmeMax: nvme.length ? Math.max(...nvme) : null,
    lo: mid - span / 2,
    hi: mid + span / 2,
  };
}

/** "кулер выкл" for a fan that is not turning on a cool board (the official cooler idles below ~50 °C), the speed otherwise. */
export function fanText(rpm: number, socTempC: number | undefined): { text: string; warn: boolean } {
  if (rpm > 0) return { text: `кулер ${rpm} об/мин`, warn: false };

  return (socTempC ?? 0) >= 65 ? { text: 'кулер стоит', warn: true } : { text: 'кулер выкл', warn: false };
}
