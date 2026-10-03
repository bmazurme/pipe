import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: boolean;
  pendingMigrations: boolean;
}

@Injectable()
export class AppService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Plain liveness — no DB round trip, just proves the process itself is up
  // and serving (see bridge-stack.yml's own comment on why GET / stays this
  // cheap: it's what distinguishes "the container never started" from
  // "started but can't reach Postgres", which getHealthStatus below answers).
  getHealth(): string {
    return 'ok';
  }

  // Readiness: the process can actually reach Postgres, and — since
  // migrationsRun: !isDev (see config/type-orm.config.ts) is supposed to
  // apply every pending migration on boot — there isn't a migration that
  // silently failed to run. 'degraded' maps to a non-2xx in the controller,
  // which is what lets a Swarm healthcheck/rollback actually catch this
  // instead of only ever seeing the trivial getHealth() above succeed.
  async getHealthStatus(): Promise<HealthStatus> {
    let database = false;
    let pendingMigrations = true;

    try {
      await this.dataSource.query('SELECT 1');
      database = true;
      pendingMigrations = await this.dataSource.showMigrations();
    } catch {
      // Leaves database=false, pendingMigrations=true (the safe/pessimistic
      // default) — a DB that can't even be reached can't be asked about its
      // own migration state either.
    }

    return {
      status: database && !pendingMigrations ? 'ok' : 'degraded',
      database,
      pendingMigrations,
    };
  }
}
