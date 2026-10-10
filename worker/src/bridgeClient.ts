// No request here had an AbortSignal before — a hung connection on `claim`
// in particular would freeze the whole poll loop forever, not just one
// request (see index.ts's main loop, which calls claim every tick).
// Transfers get a longer budget since a parcel/result can be a real file.
const API_TIMEOUT_MS = 15_000;
const TRANSFER_TIMEOUT_MS = 120_000;
const UPLOAD_RETRY_DELAYS_MS = [2000, 5000];
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

export type RemoteJobStatus = 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RemoteJob {
  id: number;
  sourceFileId: number;
  resultFileId: number | null;
  model: 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';
  // Resolved by bridge from the job's chosen named credential (see bridge's
  // ClaudeCredentialsService) — only ever present for sonnet/opus, and only
  // when one was picked. Absent/null means fall back to this process's own
  // inherited CLAUDE_CODE_OAUTH_TOKEN env var, same as before this field
  // existed.
  claudeToken?: string | null;
  // Background text the owner attached at launch (bridge's Context module), or
  // null/absent for a job with none — the default.
  context?: string | null;
  // Outcomes of earlier runs of the same task, when the owner asked for them — bridge
  // assembles the text; null/absent for the default (none).
  history?: string | null;
  status: RemoteJobStatus;
}

// A worker instance authenticates with a single personal API key — the same
// "unified machine auth" mechanism sync/reports already use — so, unlike
// sync's own BridgeClient, there's no browser-session refresh-token dance
// to implement here at all.
export class WorkerBridgeClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  private authHeaders(json = false): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  // Returns null when nothing is queued right now — bridge sends an empty
  // body for that case (204 is the current behavior; an older deployment
  // may still send 201 with no body), never a 200 with JSON "null".
  // response.json() throws on an empty body ("Unexpected end of JSON
  // input"), so this checks the raw text first rather than assuming a
  // specific status code — robust either way, and to bridge deployments
  // that haven't picked up the 204 fix yet.
  async claim(workerName: string): Promise<RemoteJob | null> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/claim`, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify({ workerName }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Claim failed (${response.status}): ${await response.text()}`);
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as RemoteJob | null) : null;
  }

  // Claim-less liveness ping for while a long job is running (claim is the
  // only other thing that records one, and the main loop doesn't poll then).
  async heartbeat(workerName: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/heartbeat`, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify({ workerName }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Heartbeat failed (${response.status})`);
    }
  }

  async downloadParcel(jobId: number): Promise<Buffer> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/parcel`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Downloading parcel for job ${jobId} failed (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async updateStatus(
    jobId: number,
    status: 'running' | 'succeeded' | 'failed' | 'cancelled',
    errorMessage?: string,
  ): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/status`, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify({ status, errorMessage }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Updating status for job ${jobId} failed (${response.status})`);
    }
  }

  // Whether the owner asked to stop this job (or bridge already cancelled it).
  // Polled while a job runs — a CLI that prints nothing for minutes sends no log
  // chunks to piggyback the answer on, so it needs a request of its own.
  async isCancelRequested(jobId: number): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/cancel-state`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Checking job ${jobId} failed (${response.status})`);
    }

    const job = (await response.json()) as { status?: string; cancelRequestedAt?: string | null };

    return job.status === 'cancelled' || Boolean(job.cancelRequestedAt);
  }

  // Best-effort by design: a log line that fails to reach bridge shouldn't
  // abort the job itself, only be swallowed with a local console warning by
  // the caller (see index.ts) — the job's real outcome is its final status.
  async appendLog(jobId: number, chunk: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/logs`, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: JSON.stringify({ chunk }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Appending log for job ${jobId} failed (${response.status})`);
    }
  }

  // The run before this call can take up to 30 minutes, so a transient failure
  // here (network error, timeout, 502/503/504 during a bridge redeploy) is
  // retried rather than discarding the finished work. 4xx is never retried.
  // `delaysMs` is injectable so tests don't sleep; its length is the retry count.
  async uploadResult(
    jobId: number,
    filename: string,
    buffer: Buffer,
    delaysMs: number[] = UPLOAD_RETRY_DELAYS_MS,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      let failure: Error;
      let retryable: boolean;

      try {
        // A used FormData body can't be reused, so rebuild it per attempt.
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(buffer)]), filename);

        const response = await fetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/result`, {
          method: 'POST',
          headers: this.authHeaders(),
          body: form,
          signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
        });

        if (response.ok) return;

        failure = new Error(
          `Uploading result for job ${jobId} failed (${response.status}): ${await response.text()}`,
        );
        retryable = RETRYABLE_STATUSES.has(response.status);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        retryable = failure instanceof TypeError || failure.name === 'TimeoutError';
      }

      if (!retryable || attempt >= delaysMs.length) throw failure;

      console.warn(
        `Uploading result for job ${jobId} failed (attempt ${attempt + 1}), retrying in ${delaysMs[attempt]} ms: ${failure.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}
