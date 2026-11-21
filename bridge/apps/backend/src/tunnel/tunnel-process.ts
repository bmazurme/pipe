import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import {
  buildXrayConfig,
  parseVless,
  poolKey,
  type VlessParams,
} from './xray-config';

export interface TunnelLog {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface TunnelProcessOptions {
  /** Where the config file lives (0600, removed on stop). */
  dir: string;
  xrayBin?: string;
  port: number;
  fingerprint?: string;
  log?: TunnelLog;
  /** Test hooks. */
  spawnProcess?: (bin: string, args: string[]) => ChildProcess;
  waitForPort?: (port: number, timeoutMs: number) => Promise<boolean>;
  now?: () => number;
}

const READY_TIMEOUT_MS = 8000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;

// 6 hex characters per line of a pool key: enough to see which links differ between two keys, not enough to recover anything.
function fingerprints(key: string): string {
  return key
    .split('\n')
    .map((line) =>
      line === '--standby--'
        ? '|'
        : createHash('sha1').update(line).digest('hex').slice(0, 6),
    )
    .join(' ');
}

export function isPortOpen(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });

      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, 200);
      });
    };

    attempt();
  });
}

// Runs one Xray client for a pool of vless:// links, the way the worker runs its own (worker/src/vpn/tunnel.ts): the same pool keeps the
// running tunnel, a changed one restarts it, none stops it, a tunnel that died is started again — with a back-off for a pool that keeps
// failing. Never throws: a broken VPN setting must not stop the backend.
export class TunnelProcess {
  private child: ChildProcess | null = null;
  private current: string | null = null;
  private currentLinks = 0;
  private currentStandby = 0;
  private failed: string | null = null;
  private failures = 0;
  private retryAt = 0;
  private skipLogged = false;
  // The binary could not be started at all (not installed in this image): not retried, not an error on every tick.
  private missing = false;

  constructor(private readonly options: TunnelProcessOptions) {}

  get proxyUrl(): string {
    return `http://127.0.0.1:${this.options.port}`;
  }

  get isMissing(): boolean {
    return this.missing;
  }

  private get configPath(): string {
    return path.join(this.options.dir, 'xray-bridge-tunnel.json');
  }

  private alive(): boolean {
    return (
      this.child !== null && this.child.exitCode === null && !this.child.killed
    );
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private resetBackoff(): void {
    this.failed = null;
    this.failures = 0;
    this.retryAt = 0;
    this.skipLogged = false;
  }

  private markFailed(wanted: string): void {
    this.failures = this.failed === wanted ? this.failures + 1 : 1;
    this.failed = wanted;
    this.retryAt =
      this.now() +
      Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
    this.skipLogged = false;
  }

  /** How many links the running tunnel was built from (0 when none runs). */
  get linkCount(): number {
    return this.alive() && this.current ? this.currentLinks : 0;
  }

  /** How many of its links are the cold standby (see buildXrayConfig). */
  get standbyCount(): number {
    return this.alive() && this.current ? this.currentStandby : 0;
  }

  /** The proxy URL to route through, or null when there is no working tunnel. */
  async apply(
    links: string[],
    standbyLinks: string[] = [],
  ): Promise<string | null> {
    const pool = links.map((entry) => entry.trim()).filter(Boolean);
    // Without a pool there is nothing to back up.
    const standby =
      pool.length > 0
        ? standbyLinks.map((entry) => entry.trim()).filter(Boolean)
        : [];
    const wanted = pool.length > 0 ? poolKey(pool, standby) : null;

    if (!wanted) {
      this.resetBackoff();
      this.stop();

      return null;
    }

    if (this.missing) return null;
    if (this.alive() && wanted === this.current) return this.proxyUrl;

    if (this.alive() && this.current !== null) {
      // A running tunnel is being replaced: say why, with short fingerprints (no secrets) so a pool that flaps can be told from a real change.
      this.options.log?.info(
        `the pool changed, restarting the tunnel: [${fingerprints(this.current)}] -> [${fingerprints(wanted)}]`,
      );
    }

    if (this.failed !== wanted) this.resetBackoff();
    else if (this.now() < this.retryAt) {
      if (!this.skipLogged) {
        this.skipLogged = true;
        this.options.log?.warn(
          `the tunnel failed recently — not restarting it for ${Math.ceil((this.retryAt - this.now()) / 1000)} s`,
        );
      }

      return null;
    }

    this.stop();

    try {
      const usable: VlessParams[] = [];

      for (const entry of pool) {
        try {
          usable.push(parseVless(entry));
        } catch (error) {
          this.options.log?.warn(
            `a link of the pool cannot be used and is left out: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (usable.length === 0) throw new Error('none of the links can be used');

      const usableStandby: VlessParams[] = [];

      for (const entry of standby) {
        try {
          usableStandby.push(parseVless(entry));
        } catch (error) {
          this.options.log?.warn(
            `a standby link cannot be used and is left out: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const config = buildXrayConfig(
        usable,
        this.options.port,
        this.options.fingerprint?.trim() || undefined,
        usableStandby,
      );

      mkdirSync(this.options.dir, { recursive: true });
      writeFileSync(this.configPath, JSON.stringify(config), { mode: 0o600 });

      const child = (
        this.options.spawnProcess ??
        ((bin, args) =>
          spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] }))
      )(this.options.xrayBin ?? 'xray', ['run', '-config', this.configPath]);

      this.child = child;
      this.current = wanted;
      this.currentLinks = usable.length;
      this.currentStandby = usableStandby.length;
      child.stderr?.on('data', (chunk: Buffer) =>
        this.options.log?.warn(`xray: ${chunk.toString('utf-8').trim()}`),
      );
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          this.missing = true;
          this.options.log?.warn(
            'xray is not installed here — the bridge tunnel is off',
          );
        } else {
          this.options.log?.error(
            `the tunnel could not start: ${error.message}`,
          );
        }
      });
      child.on('exit', (code) => {
        if (this.child === child) {
          this.options.log?.warn(
            `the tunnel exited (${code}) — it is started again on the next check`,
          );
          this.child = null;
          this.markFailed(wanted);
        }
      });

      const ready = await (this.options.waitForPort ?? isPortOpen)(
        this.options.port,
        READY_TIMEOUT_MS,
      );

      if (!ready || !this.alive()) {
        if (!this.missing) {
          this.options.log?.error('the tunnel did not come up');
          this.markFailed(wanted);
        }

        this.stop();

        return null;
      }

      this.resetBackoff();
      this.options.log?.info(
        `the tunnel is up (${usable.length} link(s)${usableStandby.length > 0 ? `, ${usableStandby.length} in cold standby` : ''})`,
      );

      return this.proxyUrl;
    } catch (error) {
      this.options.log?.error(
        `the links of the active connection cannot be used: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.stop();
      this.markFailed(wanted);

      return null;
    }
  }

  stop(): void {
    const child = this.child;

    this.child = null;
    this.current = null;

    if (child && child.exitCode === null) child.kill('SIGTERM');

    rmSync(this.configPath, { force: true });
  }
}
