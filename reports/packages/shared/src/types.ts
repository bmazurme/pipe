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
