import { WorkerHeartbeatStatus } from '../worker-heartbeat.service';

export class WorkerStatusResponseDto {
  isUp: boolean;
  workers: { name: string; lastSeenAt: Date; isUp: boolean }[];

  static fromHeartbeats(
    heartbeats: WorkerHeartbeatStatus[],
  ): WorkerStatusResponseDto {
    return {
      isUp: heartbeats.some((worker) => worker.isUp),
      workers: heartbeats,
    };
  }
}
