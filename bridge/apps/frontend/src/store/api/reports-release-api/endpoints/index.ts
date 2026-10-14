import reportsReleaseApi from '..';

export interface ReportsReleaseInfo {
  sha: string;
  shortSha: string;
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
