import { saveCredentials } from '../credentials.js';
import { log } from '../log.js';

export function loginCommand(refreshToken: string): void {
  saveCredentials({ refreshToken });
  log.info('Saved. sync-cli will keep rotating this token on its own after each command.');
}
