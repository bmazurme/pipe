import boardsApi from '..';

export type ScriptStatus = 'current' | 'outdated' | 'missing';

export interface BoardScript {
  installed: string;
  repoPath: string;
  status: ScriptStatus;
  installedHash: string | null;
  mainHash: string | null;
}

export interface BoardHealth {
  diskUsedPct?: number;
  diskFreeMb?: number;
  inodesUsedPct?: number;
  sshPasswordAuth?: boolean;
  sshAuthorizedKeys?: number;
  sshdActive?: boolean;
  workers?: BoardWorker[];
  /** Whether the filter that keeps worker containers off the home network is in place (agent v5+, boards with workers only). */
  workerEgress?: boolean;
  /** What `stable` of the worker image is in the registry now, as the agent saw it. */
  workerImageLatest?: string;
}

/** A worker container (pipe-worker-pi-…) the board's agent found, with the image it runs. */
export interface BoardWorker {
  name: string;
  image: string;
  running: boolean;
  restartCount?: number;
  startedAt?: string;
  oomKilled?: boolean;
  /** The release the container runs (manifest-list digest); absent when the agent does not say. */
  digest?: string;
}

export type DriftLevel = 'bad' | 'warn';

/** One thing that has drifted or is failing quietly (R1): a worker container that restarts, an image that is not `stable`, a failed update. */
export interface DriftItem {
  id: string;
  level: DriftLevel;
  subject: string;
  text: string;
}

export interface DriftView {
  status: 'ok' | 'warn' | 'bad';
  items: DriftItem[];
}

export interface Board {
  host: string;
  reportedAt: string;
  /** Reported within the last three hours. */
  online: boolean;
  /** The commit of main the scripts were compared with. */
  mainSha: string;
  agentVersion: string | null;
  scripts: BoardScript[];
  /** Root disk and SSH, as the board last reported them; null for an agent that predates it. */
  health: BoardHealth | null;
  /** Problems found in `health`, already worded. */
  warnings: string[];
  outdated: number;
  /** Outdated scripts a button may update (not the agent itself). */
  updatable: number;
  /** The owner's decision waiting for the board to pick it up. */
  pending: { id: number; sha: string; via: string; createdAt: string } | null;
  lastUpdate: { id: number; status: string; sha: string; result: string | null; finishedAt: string | null; createdAt: string } | null;
  /** The worker containers on this board; «Обновить worker» is offered only where there are some. */
  workers: BoardWorker[];
  /** R2: the worker containers that run a release other than the current `stable`. */
  imageBehind: string[];
  /** The owner's decision to update the worker(s), waiting for the board to pick it up. */
  workerPending: { id: number; via: string; createdAt: string } | null;
  workerLast: { id: number; status: string; result: string | null; finishedAt: string | null; createdAt: string } | null;
}

/** R2: whether bridge updates the workers by itself, and the daily window it may. */
export interface AutoUpdate {
  enabled: boolean;
  window: string;
  timezone: string;
  inWindowNow: boolean;
  last: { host: string; status: string; at: string | null; result: string | null } | null;
}

function errorMessage(fallback: string) {
  return (response: { data?: unknown }) => (response.data as { message?: string } | undefined)?.message ?? fallback;
}

const boardsApiEndpoints = boardsApi.injectEndpoints({
  endpoints: (builder) => ({
    listBoards: builder.query<Board[], void>({
      query: () => 'boards',
      providesTags: ['Boards'],
      transformErrorResponse: errorMessage('Не удалось загрузить платы'),
    }),
    getDrift: builder.query<DriftView, void>({
      query: () => 'boards/drift',
      providesTags: ['Boards'],
      transformErrorResponse: errorMessage('Не удалось получить дрейф'),
    }),
    getAutoUpdate: builder.query<AutoUpdate, void>({
      query: () => 'boards/auto-update',
      providesTags: ['Boards'],
      transformErrorResponse: errorMessage('Не удалось загрузить настройку автообновления'),
    }),
    saveAutoUpdate: builder.mutation<AutoUpdate, { enabled: boolean; window: string; timezone: string }>({
      query: (body) => ({ url: 'boards/auto-update', method: 'PUT', body }),
      invalidatesTags: ['Boards'],
      transformErrorResponse: errorMessage('Не удалось сохранить автообновление'),
    }),
    requestBoardUpdate: builder.mutation<{ id: number; sha: string; repoPaths: string[]; status: string }, string>({
      query: (host) => ({ url: `boards/${encodeURIComponent(host)}/updates`, method: 'POST' }),
      invalidatesTags: ['Boards'],
      transformErrorResponse: errorMessage('Не удалось разрешить обновление'),
    }),
    requestWorkerUpdate: builder.mutation<{ id: number; status: string }, string>({
      query: (host) => ({ url: `boards/${encodeURIComponent(host)}/worker-update`, method: 'POST' }),
      invalidatesTags: ['Boards'],
      transformErrorResponse: errorMessage('Не удалось разрешить обновление worker'),
    }),
    cancelWorkerUpdate: builder.mutation<void, string>({
      query: (host) => ({ url: `boards/${encodeURIComponent(host)}/worker-update/cancel`, method: 'POST' }),
      invalidatesTags: ['Boards'],
      transformErrorResponse: errorMessage('Не удалось отменить обновление worker'),
    }),
    cancelBoardUpdate: builder.mutation<void, string>({
      query: (host) => ({ url: `boards/${encodeURIComponent(host)}/updates/cancel`, method: 'POST' }),
      invalidatesTags: ['Boards'],
      transformErrorResponse: errorMessage('Не удалось отменить обновление'),
    }),
  }),
});

export const {
  useListBoardsQuery,
  useGetDriftQuery,
  useGetAutoUpdateQuery,
  useSaveAutoUpdateMutation,
  useRequestBoardUpdateMutation,
  useCancelBoardUpdateMutation,
  useRequestWorkerUpdateMutation,
  useCancelWorkerUpdateMutation,
} = boardsApiEndpoints;

export default boardsApiEndpoints;
