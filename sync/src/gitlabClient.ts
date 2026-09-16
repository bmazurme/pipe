export interface GitlabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
}

// apiUrl is expected to already include the API prefix, e.g.
// "https://gitlab.example.com/api/v4" (mirrors reports' subscription/gitlab-client.ts).
export async function getIssue(
  apiUrl: string,
  privateToken: string,
  projectId: string | number,
  iid: string | number,
): Promise<GitlabIssue> {
  const url = `${apiUrl}/projects/${encodeURIComponent(String(projectId))}/issues/${encodeURIComponent(String(iid))}`;
  const response = await fetch(url, { headers: { 'Private-Token': privateToken } });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GitLab API returned ${response.status} for ${url}${body ? `: ${body}` : ''}`);
  }

  return (await response.json()) as GitlabIssue;
}
