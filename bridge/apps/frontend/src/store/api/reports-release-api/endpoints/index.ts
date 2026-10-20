import reportsReleaseApi from '..';

export interface ReportsReleaseInfo {
  /** The head of main this build was cut from. */
  sha: string;
  shortSha: string;
  /** A hash of what goes into the zip (reports/ + packages/protocol/): it changes only when reports itself does. */
  releaseId: string;
  shortId: string;
  /** reports/package.json's version, for people to read. */
  version: string | null;
  sha256: string;
  size: number;
}

const reportsReleaseApiEndpoints = reportsReleaseApi.injectEndpoints({
  endpoints: (builder) => ({
    getReportsReleaseInfo: builder.query<ReportsReleaseInfo, void>({
      query: () => 'reports-release/info',
    }),

    // Download, not an upload-style fetch — same blob/object-URL/anchor-click
    // pattern as storage-api's downloadFile.
    downloadReportsRelease: builder.mutation<void, void>({
      query: () => ({
        url: 'reports-release/download',
        responseHandler: (response: Response) => response.blob(),
      }),
      transformResponse: (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'reports-latest.zip';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      },
    }),
  }),
});

export const {
  useGetReportsReleaseInfoQuery,
  useDownloadReportsReleaseMutation,
} = reportsReleaseApiEndpoints;
export { reportsReleaseApiEndpoints };
