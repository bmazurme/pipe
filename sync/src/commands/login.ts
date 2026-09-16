import { saveCredentials } from '../credentials.js';

export function loginCommand(refreshToken: string): void {
  saveCredentials({ refreshToken });
  console.log('Saved. sync-cli will keep rotating this token on its own after each command.');
}
