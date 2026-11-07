import { AUTH_FAILURE_PATTERN } from './worker.service';

describe('AUTH_FAILURE_PATTERN', () => {
  it.each([
    'Model run exited with code 1: Failed to authenticate. API Error: 403 Request not allowed',
    'Model run exited with code 1: API Error: 401',
    'Model run exited with code 1: Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead',
  ])('matches %s', (message) => {
    expect(AUTH_FAILURE_PATTERN.test(message)).toBe(true);
  });

  it.each([
    'claude timed out after 600s and was killed',
    'Fusion add-in is not running',
    'No recognized manifest',
    'Job 1401 failed: out of memory',
  ])('does not match %s', (message) => {
    expect(AUTH_FAILURE_PATTERN.test(message)).toBe(false);
  });
});
