import { saveGitlabToken } from '../credentials.js';

export function loginGitlabCommand(token: string): void {
  saveGitlabToken(token);
  console.log('Saved GitLab personal access token, used by push-issue to read issue title/description.');
}
