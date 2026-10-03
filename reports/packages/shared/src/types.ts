export type StreamEventType =
  | 'message'
  | 'done'
  | 'error';

export interface StreamEvent {
  type: StreamEventType;
  data?: any;
}

export type KeyType = 'allDays' | 'holidays' | 'weekends' | 'offDays' | 'shortDays' | 'workDays' | 'hours';
export type MonthType = {
  allDays: number;
  holidays: number;
  weekends: number;
  offDays: number;
  shortDays: number;
  workDays: number;
  hours: number;
}

export type MonthKeyType = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12';

export type DateType = {
  calendar: Record<MonthKeyType, MonthType>;
  holidays: string[];
  shortDays: string[];
  badDays: string[];
  offDays: string[];
}
export type ReportType = {
  name: string;
  status: string;
  time: number;
};

export type SettingsType = {
  gitlabUrl: string;
  privateToken: string;
  userId: string;
  employee: string;
  company: string;
  bridgeApiUrl: string;
  bridgeApiKey: string;
  bridgeRefreshToken: string;
  // Bridge Storage personal API key (Profile page → API keys) —
  // distinct from bridgeApiKey above, which is the unrelated shared secret
  // for bridge's /api/v1/time/* endpoints. Preferred over bridgeRefreshToken
  // when set: no impersonated browser session, no rotation to persist.
  bridgeStorageApiKey: string;
};

export type DayOffsImportType = {
  year: number;
  holidays: string[];
  shortDays: string[];
  offDays: string[];
  badDays: string[];
};

export type BridgeReportEntry = {
  taskName: string;
  status: string;
  hours: number;
};

export type PushReportPayload = {
  year: number;
  month: number;
  entries: BridgeReportEntry[];
};

export type ProjectDictType = Record<string, string>;

export type UserType = {
  id: number;
  username: string;
}


export type ResType = {
  id: string;
  iid: string;
  title: string;
  description?: string;
  web_url?: string;
  project_id: number;
  state: string;
  created_at: string;
  time_stats?: {
    human_time_estimate: string;
  },
}

export type IssueResponse = ResType[];

export type ResultType = {
  id: string;
  iid: string;
  title: string;
  project: number;
  status: string;
  created: string;
  timeStats: string;
}

export type TrackedProjectType = {
  gitlabProjectId: string;
  path: string;
  baseBranch?: string;
  include?: string[];
  exclude?: string[];
};

export type DictionaryEntryType = {
  key: string;
  value: string;
};

export type CommentTemplateType = {
  id: string;
  title: string;
  body: string;
};

export type EncryptionSettingsType = {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
};

export type SubscriptionConfigType = {
  trackedProjects: TrackedProjectType[];
  dictionary: DictionaryEntryType[];
  commentTemplates: CommentTemplateType[];
  encryption: EncryptionSettingsType;
  // When true, handlePushSubscriptionIssue aborts instead of just warning if
  // its final leak scan (right before upload) finds something — the sync
  // CLI's own --strict equivalent. Defaults to false/undefined (warn-only,
  // today's behavior) for anyone who hasn't opted in.
  leakScanStrict?: boolean;
};

// Everything a user configures by hand, bundled for moving to a new machine
// in one file — the calendar's holidays/shortDays/badDays are deliberately
// left out: those come from bridge (see DayOffsImportType/importDayOffs),
// not from the user, so re-importing them here would just be stale data
// racing the real source. offDaysByYear only carries the personal
// exceptions the user actually added (addOffDays).
export type SettingsBundleType = {
  version: number;
  exportedAt: string;
  settings: SettingsType;
  subscriptionConfig: SubscriptionConfigType;
  projectDict: ProjectDictType;
  offDaysByYear: Record<string, string[]>;
};

export type SubscriptionStepType = 'init' | 'pushed' | 'pulled' | 'published';

export type SubscriptionStateEntryType = {
  step: SubscriptionStepType;
  branch?: string;
  parcelId?: number;
  pushedAt?: string;
  pulledAt?: string;
  publishedAt?: string;
  encrypted?: boolean;
  // Set only for a parcel created by hand (no real GitLab issue backing
  // it) — title/description live here instead of being fetched from
  // GitLab, and projectId is stored since there's no live issue to read it
  // off of. handleListSubscriptionIssues synthesizes a row for these;
  // handlePushSubscriptionIssue/handlePublishSubscriptionIssue skip the
  // GitLab-only parts (image scraping, posting a comment) for them.
  manual?: boolean;
  title?: string;
  description?: string;
  projectId?: number;
};

export type SubscriptionIssueType = {
  id: string;
  iid: string;
  projectId: number;
  projectName: string;
  title: string;
  description: string;
  webUrl: string;
  timeEstimate: string;
  state: string;
  status: string;
  tracked: boolean;
  subscription?: SubscriptionStateEntryType;
};

export type SubscriptionPublishPayload = {
  templateId?: string;
  comment?: string;
  timeEstimate?: string;
};

// Mirrors @pipe/protocol's LeakFinding structurally, declared independently
// rather than imported — reports' client has no dependency on @pipe/protocol
// at all (unlike bridge's frontend), and this type only needs to travel as
// plain JSON over the wire.
export type LeakFindingType = {
  source: string;
  line: number;
  kind: 'email' | 'ip' | 'hostname' | 'token';
  match: string;
};

// GET .../draft's response — the anonymized title/description a push would
// send, without actually sending it, so the client can show/edit it first.
export type SubscriptionDraftType = {
  issueId: string;
  projectId: number;
  title: string;
  description: string;
  leaks: LeakFindingType[];
};

// Body for both POST .../push (real or manual issue) and
// POST /subscription/issues/manual (create a manual one).
export type SubscriptionPushPayload = {
  issueId: string;
  projectId: number;
  title: string;
  description: string;
};

export type CreateManualSubscriptionIssuePayload = {
  gitlabProjectId: string;
  title: string;
  description: string;
};

// Body/response for POST /subscription/purge/apply — reports' own
// paste-text-get-(de)anonymized-result page, equivalent to bridge's Purge
// Apply tab but running server-side (reports' client has no @pipe/protocol
// dependency, unlike bridge's frontend).
export type PurgeApplyPayload = {
  text: string;
  direction: 'toRemote' | 'toLocal';
};

export type PurgeApplyResultType = {
  result: string;
  count: number;
  leaks: LeakFindingType[];
};
