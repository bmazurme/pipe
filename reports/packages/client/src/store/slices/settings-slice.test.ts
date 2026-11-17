import { describe, it, expect, beforeEach } from 'vitest';

import settingsReducer, { setSettings, initialStateSettings, type SettingsState } from './settings-slice';

describe('settings slice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('has empty defaults', () => {
    expect(initialStateSettings).toEqual({
      gitlabUrl: '',
      privateToken: '',
      userId: '',
      employee: '',
      company: '',
      bridgeApiUrl: '',
      bridgeApiKey: '',
    });
  });

  it('replaces the state and persists it to localStorage', () => {
    const next: SettingsState = {
      gitlabUrl: 'https://gitlab.example.com/api/v4',
      privateToken: 'token',
      userId: '1',
      employee: 'Иван Иванов',
      company: 'ACME',
      bridgeApiUrl: 'http://localhost:3002/api/v1/time/export/day-offs',
      bridgeApiKey: 'dev-key',
    };

    const state = settingsReducer(initialStateSettings, setSettings(next));

    expect(state).toEqual(next);
    expect(JSON.parse(localStorage.getItem('settings')!)).toEqual(next);
  });
});
