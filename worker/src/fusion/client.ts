import type { FusionAddinConfig } from './config.js';

export type FusionView = 'iso' | 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';
export const FUSION_VIEWS: readonly FusionView[] = ['iso', 'front', 'back', 'top', 'bottom', 'left', 'right'];

export type FusionExportFormat = 'step' | 'stl' | 'f3d' | 'iges';
export const FUSION_EXPORT_FORMATS: readonly FusionExportFormat[] = ['step', 'stl', 'f3d', 'iges'];

export interface FusionRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  // The exception text and traceback of a script that failed, or null.
  error: string | null;
  traceback: string | null;
  // What the script's run(context) returned, when it was JSON-able.
  result: unknown;
}

export interface FusionHealth {
  ok: boolean;
  app: string | null;
  version: string | null;
  document: string | null;
}

// A failure of the add-in itself (not of a script): not reachable, refused the token, answered with an error.
export class FusionAddinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FusionAddinError';
  }
}

const QUICK_TIMEOUT_MS = 15_000;
// Drawing, exporting a big model and running a long script are slower than a ping.
const BINARY_TIMEOUT_MS = 120_000;
const RUN_MARGIN_MS = 15_000;

type FetchLike = typeof fetch;

export class FusionClient {
  constructor(
    private readonly config: FusionAddinConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async call(path: string, init: { method?: string; body?: unknown }, timeoutMs: number): Promise<Response> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.config.url}${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new FusionAddinError(
        `Cannot reach the pipe add-in at ${this.config.url} (${error instanceof Error ? error.message : String(error)}) — is Fusion 360 running with the add-in started?`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new FusionAddinError('The pipe add-in refused the token — restart the add-in in Fusion 360 so it writes a fresh config');
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');

      throw new FusionAddinError(`The pipe add-in answered ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`);
    }

    return response;
  }

  async health(): Promise<FusionHealth> {
    return (await (await this.call('/health', {}, QUICK_TIMEOUT_MS)).json()) as FusionHealth;
  }

  async info(): Promise<unknown> {
    return (await this.call('/info', {}, QUICK_TIMEOUT_MS)).json();
  }

  // Runs Python source inside Fusion's process. The add-in executes it on Fusion's main thread, like a script of Fusion's own.
  async run(source: string, name: string, timeoutSec = 120): Promise<FusionRunResult> {
    const response = await this.call('/run', { body: { name, source, timeoutSec } }, timeoutSec * 1000 + RUN_MARGIN_MS);

    return (await response.json()) as FusionRunResult;
  }

  async screenshot(view: FusionView, width: number, height: number): Promise<Buffer> {
    const response = await this.call('/screenshot', { body: { view, width, height } }, BINARY_TIMEOUT_MS);

    return Buffer.from(await response.arrayBuffer());
  }

  async export(format: FusionExportFormat): Promise<Buffer> {
    const response = await this.call('/export', { body: { format } }, BINARY_TIMEOUT_MS);

    return Buffer.from(await response.arrayBuffer());
  }
}
