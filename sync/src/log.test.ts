import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { log, setVerbose } from './log.js';

describe('log', () => {
  afterEach(() => {
    setVerbose(false);
  });

  it('suppresses debug output by default', () => {
    const calls: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => calls.push(args);

    try {
      log.debug('hidden by default');
    } finally {
      console.log = original;
    }

    assert.deepEqual(calls, []);
  });

  it('shows debug output once verbose is enabled', () => {
    setVerbose(true);
    const calls: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => calls.push(args);

    try {
      log.debug('shown with --verbose');
    } finally {
      console.log = original;
    }

    assert.deepEqual(calls, [['shown with --verbose']]);
  });

  it('info/warn/error always show, regardless of verbose', () => {
    const logCalls: unknown[][] = [];
    const warnCalls: unknown[][] = [];
    const errorCalls: unknown[][] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = (...args: unknown[]) => logCalls.push(args);
    console.warn = (...args: unknown[]) => warnCalls.push(args);
    console.error = (...args: unknown[]) => errorCalls.push(args);

    try {
      log.info('info message');
      log.warn('warn message');
      log.error('error message');
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }

    assert.deepEqual(logCalls, [['info message']]);
    assert.deepEqual(warnCalls, [['warn message']]);
    assert.deepEqual(errorCalls, [['error message']]);
  });
});
