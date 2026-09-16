import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './getErrorMessage';

describe('getErrorMessage', () => {
  it('extracts the message from a CUSTOM_ERROR', () => {
    const error = { status: 'CUSTOM_ERROR', error: 'файл слишком большой' };
    expect(getErrorMessage(error, 'fallback')).toBe('файл слишком большой');
  });

  it('falls back for a plain HTTP error status', () => {
    const error = { status: 404, data: { message: 'not found' } };
    expect(getErrorMessage(error, 'fallback')).toBe('fallback');
  });

  it('falls back for a non-object error', () => {
    expect(getErrorMessage('boom', 'fallback')).toBe('fallback');
  });

  it('falls back for undefined', () => {
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
