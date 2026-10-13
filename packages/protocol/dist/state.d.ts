import { z } from 'zod';
export declare const syncStateEntrySchema: z.ZodObject<{
    lastHash: z.ZodString;
    lastSyncedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const syncStateSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    lastHash: z.ZodString;
    lastSyncedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type SyncStateEntry = z.infer<typeof syncStateEntrySchema>;
export type SyncState = z.infer<typeof syncStateSchema>;
export declare const agentRunnerStateEntrySchema: z.ZodObject<{
    lastOwnOutputHash: z.ZodString;
}, z.core.$strip>;
export declare const agentRunnerStateSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    lastOwnOutputHash: z.ZodString;
}, z.core.$strip>>;
export type AgentRunnerStateEntry = z.infer<typeof agentRunnerStateEntrySchema>;
export type AgentRunnerState = z.infer<typeof agentRunnerStateSchema>;
export declare const gitlabWorkerStateEntrySchema: z.ZodObject<{
    pushedAt: z.ZodString;
    filename: z.ZodString;
}, z.core.$strip>;
export declare const gitlabWorkerStateSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    pushedAt: z.ZodString;
    filename: z.ZodString;
}, z.core.$strip>>;
export type GitlabWorkerStateEntry = z.infer<typeof gitlabWorkerStateEntrySchema>;
export type GitlabWorkerState = z.infer<typeof gitlabWorkerStateSchema>;
export declare const subscriptionStepSchema: z.ZodEnum<{
    init: "init";
    pushed: "pushed";
    pulled: "pulled";
    published: "published";
}>;
export declare const subscriptionStateEntrySchema: z.ZodObject<{
    step: z.ZodEnum<{
        init: "init";
        pushed: "pushed";
        pulled: "pulled";
        published: "published";
    }>;
    branch: z.ZodOptional<z.ZodString>;
    parcelId: z.ZodOptional<z.ZodNumber>;
    pushedAt: z.ZodOptional<z.ZodString>;
    pulledAt: z.ZodOptional<z.ZodString>;
    publishedAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
    encrypted: z.ZodOptional<z.ZodBoolean>;
    manual: z.ZodOptional<z.ZodBoolean>;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    projectId: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const subscriptionStateSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    step: z.ZodEnum<{
        init: "init";
        pushed: "pushed";
        pulled: "pulled";
        published: "published";
    }>;
    branch: z.ZodOptional<z.ZodString>;
    parcelId: z.ZodOptional<z.ZodNumber>;
    pushedAt: z.ZodOptional<z.ZodString>;
    pulledAt: z.ZodOptional<z.ZodString>;
    publishedAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
    encrypted: z.ZodOptional<z.ZodBoolean>;
    manual: z.ZodOptional<z.ZodBoolean>;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    projectId: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>>;
export type SubscriptionStep = z.infer<typeof subscriptionStepSchema>;
export type SubscriptionStateEntry = z.infer<typeof subscriptionStateEntrySchema>;
export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;
export declare function parseState<T extends z.ZodTypeAny>(schema: T, raw: unknown): {
    value: z.infer<T>;
} | {
    error: string;
};
//# sourceMappingURL=state.d.ts.map