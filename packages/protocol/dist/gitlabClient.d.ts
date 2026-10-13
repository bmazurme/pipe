export declare class GitlabApiError extends Error {
    readonly status: number;
    readonly url: string;
    readonly body: string;
    constructor(status: number, url: string, body: string);
}
export declare function gitlabFetch(url: string, privateToken: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
export interface GitlabIssue {
    id: number;
    iid: number;
    project_id: number;
    title: string;
    description: string | null;
    state?: string;
    user_notes_count?: number;
}
export declare function getIssue(apiUrl: string, privateToken: string, projectId: string | number, iid: string | number): Promise<GitlabIssue>;
export declare function listAssignedOpenIssues(apiUrl: string, privateToken: string, options?: {
    assigneeId?: string | number;
}): Promise<GitlabIssue[]>;
export interface GitlabMergeRequest {
    iid: number;
    title: string;
    state: string;
    web_url: string;
    pipeline: {
        status: string;
    } | null;
}
export declare function listMergeRequestsForBranch(apiUrl: string, privateToken: string, projectId: string | number, sourceBranch: string): Promise<GitlabMergeRequest[]>;
export declare function addSpentTime(apiUrl: string, privateToken: string, projectId: string | number, iid: string | number, duration: string): Promise<void>;
//# sourceMappingURL=gitlabClient.d.ts.map