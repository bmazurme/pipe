import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { BoardMetricsData } from '../board-metrics';

// One reading of a board's vital signs, every ~2 minutes per board, kept for 7 days (BoardMetricsService prunes). Append-only: the Dashboard tile
// shows the newest and draws the rest as a graph.
@Entity({ name: 'board_metrics' })
@Index('IDX_board_metrics_user_host_at', ['userId', 'host', 'at'])
@Index('IDX_board_metrics_at', ['at'])
export class BoardMetric {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  host: string;

  @Column({ type: 'timestamp' })
  at: Date;

  @Column({ type: 'jsonb' })
  data: BoardMetricsData;
}
