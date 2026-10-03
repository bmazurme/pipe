import { WorkerHeartbeatStatus } from '../worker-heartbeat.service';

// A named class rather than an inline object-literal array type — the
// swagger CLI plugin's schema inference (nest-cli.json's "plugins", see
// IMPROVEMENTS_TECH.md 2.2) got a false "circular dependency" on the
// anonymous shape; a real class resolves cleanly.
export class WorkerHeartbeatStatusDto {
  name: string;
  lastSeenAt: Date;
  isUp: boolean;
}

export class WorkerStatusResponseDto {
  isUp: boolean;
  workers: WorkerHeartbeatStatusDto[];

  static fromHeartbeats(
    heartbeats: WorkerHeartbeatStatus[],
  ): WorkerStatusResponseDto {
    return {
      isUp: heartbeats.some((worker) => worker.isUp),
      workers: heartbeats,
    };
  }
}
