import { Text } from '@gravity-ui/uikit';

import type { BoardSeriesPoint } from '../../store/api';
import styles from './BoardMetricsCard.module.css';
import { seriesStats, segments } from './tempSeries';

const WIDTH = 300;
const HEIGHT = 44;
// The two limits the monitor and the card use: warm from 65 °C, bad from 75 °C.
const WARM = 65;
const HOT = 75;

const path = (segs: ReturnType<typeof segments>) => segs.map((seg) => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')).join(' ');
const range = (min: number | null, max: number | null) => (min === null || max === null ? null : min === max ? `${Math.round(min)}` : `${Math.round(min)}–${Math.round(max)}`);

// The temperature of one board over the window: the processor (solid) and, when there is one, the NVMe (dashed). The vertical scale follows the data;
// the 65 and 75 °C lines are drawn only when the temperature is anywhere near them. Under it: the range in words, and the two ends of the time axis.
export function TempChart({ points, label, windowText }: { points: BoardSeriesPoint[]; label: string; windowText: string }) {
  const stats = points.length >= 2 ? seriesStats(points) : null;

  if (!stats) {
    return (
      <div className={styles.chart}>
        <svg role="img" aria-label={`${label}: графика пока нет`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT}>
          <text x={WIDTH / 2} y={HEIGHT / 2 + 4} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.5">
            мало данных для графика
          </text>
        </svg>
      </div>
    );
  }

  const t0 = Date.parse(points[0].t);
  const t1 = Date.parse(points[points.length - 1].t);
  const x = (time: number) => (t1 === t0 ? 0 : ((time - t0) / (t1 - t0)) * WIDTH);
  const y = (value: number) => HEIGHT - 2 - ((value - stats.lo) / (stats.hi - stats.lo)) * (HEIGHT - 4);
  const soc = path(segments(points, 'soc', x, y));
  const nvme = path(segments(points, 'nvme', x, y));
  const socRange = range(stats.socMin, stats.socMax);
  const nvmeRange = range(stats.nvmeMin, stats.nvmeMax);

  return (
    <div className={styles.chart}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="none">
        {[
          [WARM, 'var(--g-color-line-warning, orange)'],
          [HOT, 'var(--g-color-line-danger, red)'],
        ].map(([value, color]) =>
          (value as number) > stats.lo && (value as number) < stats.hi ? (
            <line key={value as number} x1="0" x2={WIDTH} y1={y(value as number)} y2={y(value as number)} stroke={color as string} strokeDasharray="1 3" opacity="0.7" />
          ) : null,
        )}
        {nvme && (
          <path d={nvme} fill="none" stroke="var(--g-color-text-secondary, gray)" strokeWidth="1.2" strokeDasharray="4 2" vectorEffect="non-scaling-stroke">
            <title>{`NVMe: ${nvmeRange} °C`}</title>
          </path>
        )}
        {soc && (
          <path d={soc} fill="none" stroke="var(--g-color-line-brand, royalblue)" strokeWidth="1.8" vectorEffect="non-scaling-stroke">
            <title>{`Процессор: ${socRange} °C`}</title>
          </path>
        )}
      </svg>
      <div className={styles.chartCaption}>
        <Text variant="caption-2" color="secondary">
          {windowText}
        </Text>
        <Text variant="caption-2" color="secondary">
          {[socRange && `процессор ${socRange} °C`, nvmeRange && `NVMe ${nvmeRange} °C`].filter(Boolean).join(' · ')}
        </Text>
        <Text variant="caption-2" color="secondary">
          сейчас
        </Text>
      </div>
    </div>
  );
}
