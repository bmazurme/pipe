import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { PROTOCOL_SCHEMA_VERSION, assertSchemaVersion, type BaseManifest } from './manifest.js';

const ENTRY = '__test_manifest__.json';

// Manifests are untrusted JSON, so tests feed values the declared type forbids.
const withVersion = (schemaVersion: unknown): BaseManifest =>
  ({ schemaVersion, contentHash: 'x' }) as BaseManifest;

describe('assertSchemaVersion', () => {
  for (const [label, value] of [
    ['null', null],
    ['a numeric string', '3'],
    ['a non-numeric string', 'abc'],
    ['NaN', NaN],
    ['a negative integer', -1],
    ['a float', 1.5],
    ['Infinity', Infinity],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.throws(
        () => assertSchemaVersion(withVersion(value), ENTRY),
        new RegExp(`${ENTRY} has an invalid schemaVersion \\(`),
      );
    });
  }

  it('only warns when schemaVersion is undefined', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      assert.doesNotThrow(() => assertSchemaVersion(withVersion(undefined), ENTRY));
      assert.equal(warn.mock.callCount(), 1);
    } finally {
      warn.mock.restore();
    }
  });

  it('accepts the current version and older integers', () => {
    assert.doesNotThrow(() => assertSchemaVersion(withVersion(PROTOCOL_SCHEMA_VERSION), ENTRY));
    assert.doesNotThrow(() => assertSchemaVersion(withVersion(0), ENTRY));
  });

  it('rejects a version newer than understood with the upgrade message', () => {
    assert.throws(
      () => assertSchemaVersion(withVersion(PROTOCOL_SCHEMA_VERSION + 1), ENTRY),
      /upgrade @pipe\/protocol/,
    );
  });
});
