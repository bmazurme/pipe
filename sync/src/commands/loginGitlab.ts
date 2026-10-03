import { saveGitlabToken } from '../credentials.js';
import { log } from '../log.js';

export function loginGitlabCommand(token: string): void {
  saveGitlabToken(token);
  log.info('Saved GitLab personal access token, used by push-issue to read issue title/description.');
}
