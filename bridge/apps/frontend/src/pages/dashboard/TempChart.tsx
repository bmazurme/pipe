import type { BoardSeriesPoint } from '../../store/api';
import { type Segment, segments } from './tempSeries';

const WIDTH = 300;
const HEIGHT = 56;
// The two limits the monitor and the card use: warm from 65 °C, bad from 75 °C.
const WARM = 65;
const HOT = 75;

const path = (segs: Segment[][]) => segs.map((seg) => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')).join(' ');

// The temperature of one board over the window: the processor (solid) and, when there is one, the NVMe (dashed), with the 65 and 75 °C lines.
export function TempChart({ points, label }: { points: BoardSeriesPoint[]; label: string }) {
  const values = points.flatMap((point) => [point.soc, point.nvme]).filter((value): value is number => value !== null);

  if (points.length < 2 || values.length === 0) {
    return (
      <svg role="img" aria-label={`${label}: графика пока нет`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT}>
        <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.5">
          мало данных для графика
        </text>
      </svg>
    );
  }

  const lo = Math.min(30, Math.floor(Math.min(...values)) - 2);
  const hi = Math.max(HOT + 5, Math.ceil(Math.max(...values)) + 2);
  const t0 = Date.parse(points[0].t);
  const t1 = Date.parse(points[points.length - 1].t);
  const x = (time: number) => (t1 === t0 ? 0 : ((time - t0) / (t1 - t0)) * WIDTH);
  const y = (value: number) => HEIGHT - ((value - lo) / (hi - lo)) * HEIGHT;
  const soc = path(segments(points, 'soc', x, y));
  const nvme = path(segments(points, 'nvme', x, y));

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="none">
      <line x1="0" x2={WIDTH} y1={y(WARM)} y2={y(WARM)} stroke="var(--g-color-line-warning, orange)" strokeDasharray="2 3" opacity="0.6" />
      <line x1="0" x2={WIDTH} y1={y(HOT)} y2={y(HOT)} stroke="var(--g-color-line-danger, red)" strokeDasharray="2 3" opacity="0.6" />
      {nvme && <path d={nvme} fill="none" stroke="var(--g-color-text-secondary, gray)" strokeWidth="1.2" strokeDasharray="4 2" vectorEffect="non-scaling-stroke" />}
      {soc && <path d={soc} fill="none" stroke="var(--g-color-line-brand, royalblue)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
