import { saveApiKey } from '../credentials.js';

export function loginApiKeyCommand(apiKey: string): void {
  saveApiKey(apiKey);
  console.log(
    'Saved. sync-cli will use this API key directly instead of the refresh-token dance ' +
      '(mint one from bridge\'s Profile page → API keys).',
  );
}
