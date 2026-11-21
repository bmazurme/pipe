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
}

/** A worker container (pipe-worker-pi-…) the board's agent found, with the image it runs. */
export interface BoardWorker {
  name: string;
  image: string;
  running: boolean;
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
  /** The owner's decision to update the worker(s), waiting for the board to pick it up. */
  workerPending: { id: number; via: string; createdAt: string } | null;
  workerLast: { id: number; status: string; result: string | null; finishedAt: string | null; createdAt: string } | null;
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
  useRequestBoardUpdateMutation,
  useCancelBoardUpdateMutation,
  useRequestWorkerUpdateMutation,
  useCancelWorkerUpdateMutation,
} = boardsApiEndpoints;

export default boardsApiEndpoints;
