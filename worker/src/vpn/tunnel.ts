import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { buildXrayConfig, parseVless } from './vless.js';

export interface TunnelLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface TunnelOptions {
  /** Where the config file lives (0600, removed on stop). */
  dir: string;
  xrayBin?: string;
  port?: number;
  /** TLS fingerprint for Reality: a name (firefox, chrome, safari, randomized…) or `link` for the one the link carries. */
  fingerprint?: string;
  log?: TunnelLog;
  /** Test hooks. */
  spawnProcess?: (bin: string, args: string[]) => ChildProcess;
  waitForPort?: (port: number, timeoutMs: number) => Promise<boolean>;
}

const DEFAULT_PORT = 18080;
const READY_TIMEOUT_MS = 8000;

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

// Runs the worker's own Xray client for the link set on the Worker page, so the worker needs no VPN container next to it.
// `apply` is called before every poll with the link bridge currently holds: the same link keeps the running tunnel, a
// different one restarts it, none stops it, and a tunnel that died is started again. Never throws — a broken VPN setting
// must not stop the worker polling (the failure is logged, and jobs then go out the way they did before).
export class VpnTunnel {
  private child: ChildProcess | null = null;
  private currentLink: string | null = null;
  private readonly port: number;

  constructor(private readonly options: TunnelOptions) {
    this.port = options.port ?? DEFAULT_PORT;
  }

  get proxyUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private get configPath(): string {
    return path.join(this.options.dir, 'xray-tunnel.json');
  }

  private alive(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed;
  }

  /** The proxy URL to route through, or null when there is no (working) tunnel. */
  async apply(link: string | null | undefined): Promise<string | null> {
    const wanted = link?.trim() || null;

    if (!wanted) {
      this.stop();

      return null;
    }

    if (this.alive() && wanted === this.currentLink) return this.proxyUrl;

    this.stop();

    try {
      const config = buildXrayConfig(parseVless(wanted), this.port, this.options.fingerprint?.trim() || undefined);

      mkdirSync(this.options.dir, { recursive: true });
      writeFileSync(this.configPath, JSON.stringify(config), { mode: 0o600 });

      const child = (this.options.spawnProcess ?? ((bin, args) => spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })))(
        this.options.xrayBin ?? 'xray',
        ['run', '-config', this.configPath],
      );

      this.child = child;
      this.currentLink = wanted;
      child.stderr?.on('data', (chunk: Buffer) => this.options.log?.warn({ xray: chunk.toString('utf-8').trim() }, 'vpn tunnel'));
      child.on('error', (error) => this.options.log?.error({ err: error }, 'vpn tunnel could not start (is xray installed in this image?)'));
      child.on('exit', (code) => {
        if (this.child === child) {
          this.options.log?.warn({ code }, 'vpn tunnel exited — it is started again on the next poll');
          this.child = null;
        }
      });

      const ready = await (this.options.waitForPort ?? isPortOpen)(this.port, READY_TIMEOUT_MS);

      if (!ready || !this.alive()) {
        this.options.log?.error({ port: this.port }, 'vpn tunnel did not come up');
        this.stop();

        return null;
      }

      this.options.log?.info({ proxy: this.proxyUrl }, 'vpn tunnel is up');

      return this.proxyUrl;
    } catch (error) {
      this.options.log?.error({ err: error }, 'vpn link from the Worker page cannot be used');
      this.stop();

      return null;
    }
  }

  stop(): void {
    const child = this.child;

    this.child = null;
    this.currentLink = null;

    if (child && child.exitCode === null) child.kill('SIGTERM');

    rmSync(this.configPath, { force: true });
  }
}
