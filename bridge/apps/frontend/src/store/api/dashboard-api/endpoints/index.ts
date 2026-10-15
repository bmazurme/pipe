import dashboardApi from '..';

export type NodeState = 'ready' | 'down' | 'unknown';

export interface NodeStatus {
  hostname: string;
  label: string;
  state: NodeState;
  availability: string | null;
}

export interface NodesStatus {
  nodes: NodeStatus[];
  error?: string;
}

export interface BackupStatus {
  configured: boolean;
  lastBackupAt: string | null;
  rawBytes: number | null;
  error?: string;
}

const dashboardApiEndpoints = dashboardApi.injectEndpoints({
  endpoints: (builder) => ({
    getDashboardNodes: builder.query<NodesStatus, void>({
      query: () => 'dashboard/nodes',
    }),
    getDashboardBackups: builder.query<BackupStatus, void>({
      query: () => 'dashboard/backups',
    }),
  }),
});

export const { useGetDashboardNodesQuery, useGetDashboardBackupsQuery } = dashboardApiEndpoints;
export { dashboardApiEndpoints };
