import { z } from 'zod';

// Shared schemas for the local task-state files sync, reports, and harness
// all read and write (IMPROVEMENTS_HARNESS.md 6.1) — sync's own
// `.sync-state.json`/`.sync-agent-state.json`/`.gitlab-worker-state.json`
// and reports' `subscription-state.json`. Previously each side had its own
// hand-copied TypeScript interface for the same shape ("Mirrors
// sync/src/types.ts's AgentRunnerState exactly" — a comment, not an
// enforced guarantee); if a writer's shape ever drifted from a reader's
// copy, nothing would catch it until harness silently showed wrong data.
// Writers (sync, reports) use these to validate before writing and when
// reading their own state back; harness uses them to validate when reading
// everyone else's.

export const syncStateEntrySchema = z.object({
  lastHash: z.string(),
});
export const syncStateSchema = z.record(z.string(), syncStateEntrySchema);
export type SyncStateEntry = z.infer<typeof syncStateEntrySchema>;
export type SyncState = z.infer<typeof syncStateSchema>;

export const agentRunnerStateEntrySchema = z.object({
  lastOwnOutputHash: z.string(),
});
export const agentRunnerStateSchema = z.record(z.string(), agentRunnerStateEntrySchema);
export type AgentRunnerStateEntry = z.infer<typeof agentRunnerStateEntrySchema>;
export type AgentRunnerState = z.infer<typeof agentRunnerStateSchema>;

export const gitlabWorkerStateEntrySchema = z.object({
  pushedAt: z.string(),
  filename: z.string(),
});
export const gitlabWorkerStateSchema = z.record(z.string(), gitlabWorkerStateEntrySchema);
export type GitlabWorkerStateEntry = z.infer<typeof gitlabWorkerStateEntrySchema>;
export type GitlabWorkerState = z.infer<typeof gitlabWorkerStateSchema>;

// Mirrors reports/packages/shared/src/types.ts's SubscriptionStateEntryType
// exactly — the one authoritative definition now lives here instead.
export const subscriptionStepSchema = z.enum(['init', 'pushed', 'pulled', 'published']);
export const subscriptionStateEntrySchema = z.object({
  step: subscriptionStepSchema,
  branch: z.string().optional(),
  parcelId: z.number().optional(),
  pushedAt: z.string().optional(),
  pulledAt: z.string().optional(),
  publishedAt: z.string().optional(),
  // Stamped by reports' setIssueState() on every write, regardless of step
  // — unlike pushedAt/pulledAt/publishedAt, which only exist once a task
  // has reached that specific step, this is the one timestamp the 'init'
  // step itself has, letting harness detect a task stuck at 'init' as
  // stale (IMPROVEMENTS_HARNESS.md 6.3). Optional since entries written
  // before this field existed won't have it.
  updatedAt: z.string().optional(),
  encrypted: z.boolean().optional(),
  manual: z.boolean().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  projectId: z.number().optional(),
});
export const subscriptionStateSchema = z.record(z.string(), subscriptionStateEntrySchema);
export type SubscriptionStep = z.infer<typeof subscriptionStepSchema>;
export type SubscriptionStateEntry = z.infer<typeof subscriptionStateEntrySchema>;
export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;

// Parses with a schema and returns a result shape that never throws —
// matches the existing "errors as data, not exceptions" convention each
// state-file reader (sync's loadState/loadAgentState/loadGitlabWorkerState,
// reports' readState, harness's readJson) already uses for a missing or
// JSON-malformed file, extended to also catch a well-formed-JSON-but-wrong-
// shape file the same way.
export function parseState<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): { value: z.infer<T> } | { error: string } {
  const result = schema.safeParse(raw);
  if (result.success) return { value: result.data };
  return { error: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ') };
}
