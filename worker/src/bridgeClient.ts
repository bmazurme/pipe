import {
  API_TIMEOUT_MS,
  TRANSFER_TIMEOUT_MS,
  bearer,
  bridgeFetch,
  readOptionalJson,
  reportClaudeUsage,
} from "./bridgeHttp.js";
import type { ClaudeReport } from "./modelRunners/claudeUsage.js";

const UPLOAD_RETRY_DELAYS_MS = [2000, 5000];
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

export type RemoteJobStatus =
  "queued" | "claimed" | "running" | "succeeded" | "failed" | "cancelled";

export interface RemoteJob {
  id: number;
  sourceFileId: number;
  resultFileId: number | null;
  model: "sonnet" | "opus" | "haiku" | "gpt" | "deepseek" | "qwen";
  // Resolved by bridge from the job's chosen named credential (see bridge's
  // ClaudeCredentialsService) — only ever present for sonnet/opus/haiku, and only
  // when one was picked. Absent/null means fall back to this process's own
  // inherited CLAUDE_CODE_OAUTH_TOKEN env var, same as before this field
  // existed.
  claudeToken?: string | null;
  // The API key (and optional endpoint / model) for a gpt/deepseek/qwen job, from the account's stored keys. Null/absent:
  // fall back to this process's own environment, as before stored keys existed.
  provider?: {
    apiKey: string;
    baseUrl?: string | null;
    model?: string | null;
  } | null;
  // Background text the owner attached at launch (bridge's Context module), or
  // null/absent for a job with none — the default.
  context?: string | null;
  // Outcomes of earlier runs of the same task, when the owner asked for them — bridge
  // assembles the text; null/absent for the default (none).
  history?: string | null;
  // Public key (PEM): the result parcel is encrypted with it before it is uploaded.
  resultPublicKey?: string | null;
  // A capability the job needs of its worker (bridge only hands it to a worker that has it): 'fusion' = Autodesk Fusion 360 is
  // open on this machine and the pipe add-in is running.
  requiredCapability?: string | null;
  // The run's time limit in seconds the owner chose at launch; null/absent = this worker's own jobTimeoutSec.
  timeoutSec?: number | null;
  status: RemoteJobStatus;
}

// A worker instance authenticates with a single key — its own (brw_…, from enrolment in the UI) or, the legacy way, a
// personal API key (brk_…) — so, unlike sync's own BridgeClient, there's no browser-session refresh-token dance to
// implement here at all.
export class WorkerBridgeClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  private get(
    path: string,
    what: string,
    timeoutMs = API_TIMEOUT_MS,
  ): Promise<Response> {
    return bridgeFetch(
      `${this.apiUrl}/api/v1/worker/jobs${path}`,
      { headers: bearer(this.apiKey) },
      { timeoutMs, expectOk: what },
    );
  }

  private post(
    path: string,
    what: string,
    body: unknown,
    includeBody = false,
  ): Promise<Response> {
    return bridgeFetch(
      `${this.apiUrl}/api/v1/worker/jobs${path}`,
      {
        method: "POST",
        headers: bearer(this.apiKey, true),
        body: JSON.stringify(body),
      },
      { expectOk: what, includeBody },
    );
  }

  // Returns null when nothing is queued right now (see readOptionalJson).
  async claim(workerName: string): Promise<RemoteJob | null> {
    return readOptionalJson<RemoteJob>(
      await this.post("/claim", "Claim", { workerName }, true),
    );
  }

  // Claim-less liveness ping for while a long job is running (claim is the
  // only other thing that records one, and the main loop doesn't poll then).
  async heartbeat(workerName: string): Promise<void> {
    await this.post("/heartbeat", "Heartbeat", { workerName });
  }

  // What the claude CLI reported for this job (plan limits, tokens, cost); never throws.
  reportClaudeUsage(jobId: number, report: ClaudeReport): Promise<void> {
    return reportClaudeUsage(this.apiUrl, this.apiKey, report, jobId);
  }

  // The open questions a run left, for bridge's Questions page; the caller treats a failure as non-fatal.
  async reportQuestions(jobId: number, questions: string[]): Promise<void> {
    await this.post(
      `/${jobId}/questions`,
      `Reporting questions for job ${jobId}`,
      { questions },
    );
  }

  async downloadParcel(
    jobId: number,
    delaysMs: number[] = UPLOAD_RETRY_DELAYS_MS,
  ): Promise<Buffer> {
    const response = await this.withTransientRetry(
      `Downloading parcel for job ${jobId}`,
      () =>
        bridgeFetch(
          `${this.apiUrl}/api/v1/worker/jobs/${jobId}/parcel`,
          { headers: bearer(this.apiKey) },
          { timeoutMs: TRANSFER_TIMEOUT_MS },
        ),
      delaysMs,
    );

    return Buffer.from(await response.arrayBuffer());
  }

  async updateStatus(
    jobId: number,
    status: "running" | "succeeded" | "failed" | "cancelled",
    errorMessage?: string,
    failureKind?: "shutdown",
    delaysMs: number[] = UPLOAD_RETRY_DELAYS_MS,
  ): Promise<void> {
    const what = `Updating status for job ${jobId}`;
    const body = { status, errorMessage, failureKind };

    if (status === "running") {
      // Retried like the terminal report: a blip at claim time must not fail the job before the model starts.
      await this.withTransientRetry(
        what,
        () =>
          bridgeFetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/status`, {
            method: "POST",
            headers: bearer(this.apiKey, true),
            body: JSON.stringify(body),
          }),
        delaysMs,
        [409],
      );
      return;
    }

    // A lost terminal report makes bridge sweep the job as lost and re-run it, so it is retried; a 409 on a
    // retry means the first attempt (whose response was lost) was recorded.
    await this.withTransientRetry(
      what,
      () =>
        bridgeFetch(`${this.apiUrl}/api/v1/worker/jobs/${jobId}/status`, {
          method: "POST",
          headers: bearer(this.apiKey, true),
          body: JSON.stringify(body),
        }),
      delaysMs,
      [409],
    );
  }

  // Whether the owner asked to stop this job (or bridge already cancelled it).
  // Polled while a job runs — a CLI that prints nothing for minutes sends no log
  // chunks to piggyback the answer on, so it needs a request of its own.
  async isCancelRequested(jobId: number): Promise<boolean> {
    return (await this.getRunState(jobId)).cancelRequested;
  }

  // The same poll also carries the seconds the owner added to the time limit (null = never extended).
  async getRunState(
    jobId: number,
  ): Promise<{ cancelRequested: boolean; extraTimeoutSec: number | null }> {
    const response = await this.get(
      `/${jobId}/cancel-state`,
      `Checking job ${jobId}`,
    );

    const job = (await response.json()) as {
      status?: string;
      cancelRequestedAt?: string | null;
      extraTimeoutSec?: number | null;
    };

    return {
      cancelRequested:
        job.status === "cancelled" || Boolean(job.cancelRequestedAt),
      extraTimeoutSec: job.extraTimeoutSec ?? null,
    };
  }

  // Best-effort by design: a log line that fails to reach bridge shouldn't
  // abort the job itself, only be swallowed with a local console warning by
  // the caller (see index.ts) — the job's real outcome is its final status.
  async appendLog(jobId: number, chunk: string): Promise<void> {
    await this.post(`/${jobId}/logs`, `Appending log for job ${jobId}`, {
      chunk,
    });
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
    await this.withTransientRetry(
      `Uploading result for job ${jobId}`,
      () => {
        // A used FormData body can't be reused, so rebuild it per attempt.
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(buffer)]), filename);

        return bridgeFetch(
          `${this.apiUrl}/api/v1/worker/jobs/${jobId}/result`,
          { method: "POST", headers: bearer(this.apiKey), body: form },
          { timeoutMs: TRANSFER_TIMEOUT_MS },
        );
      },
      delaysMs,
    );
  }

  // Retries `attempt` on 502/503/504, a network TypeError or a TimeoutError; anything else throws at once.
  // `deliveredOnRetry` lists statuses that, on a retry only, mean the first attempt got through.
  private async withTransientRetry(
    what: string,
    attempt: () => Promise<Response>,
    delaysMs: number[],
    deliveredOnRetry: number[] = [],
  ): Promise<Response> {
    for (let n = 0; ; n++) {
      let failure: Error;
      let retryable: boolean;

      try {
        const response = await attempt();

        if (
          response.ok ||
          (n > 0 && deliveredOnRetry.includes(response.status))
        )
          return response;

        failure = new Error(
          `${what} failed (${response.status}): ${await response.text()}`,
        );
        retryable = RETRYABLE_STATUSES.has(response.status);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        retryable =
          failure instanceof TypeError || failure.name === "TimeoutError";
      }

      if (!retryable || n >= delaysMs.length) throw failure;

      console.warn(
        `${what} failed (attempt ${n + 1}), retrying in ${delaysMs[n]} ms: ${failure.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delaysMs[n]));
    }
  }
}
