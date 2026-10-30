import inboxApi from '..';

export type InboxSeverity = 'high' | 'medium' | 'low';

export type InboxKind =
  | 'pr_ready'
  | 'pr_failing'
  | 'pr_waiting'
  | 'questions'
  | 'board_offline'
  | 'board_warning'
  | 'board_outdated'
  | 'limit'
  | 'worker_offline'
  | 'jobs_failed'
  | 'loop_paused';

/** One thing that needs the owner's attention, already ordered by the server (most urgent first). */
export interface InboxItem {
  id: string;
  kind: InboxKind;
  severity: InboxSeverity;
  title: string;
  detail?: string;
  /** ISO time it started to need attention. */
  since?: string;
  /** A route of this app. */
  link: string;
  /** The pull request on GitHub, when the item is one. */
  externalUrl?: string;
}

const inboxApiEndpoints = inboxApi.injectEndpoints({
  endpoints: (builder) => ({
    listInbox: builder.query<InboxItem[], void>({
      query: () => 'inbox',
      providesTags: ['Inbox'],
    }),
  }),
});

export const { useListInboxQuery } = inboxApiEndpoints;

export default inboxApiEndpoints;
