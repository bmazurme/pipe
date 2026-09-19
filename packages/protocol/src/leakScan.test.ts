import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scanForLeaks, formatLeakFindings } from './leakScan.js';

describe('scanForLeaks', () => {
  it('flags an email address', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'contact: dev@prod-internal.example.net' }]);
    assert.ok(findings.some((f) => f.kind === 'email' && f.match === 'dev@prod-internal.example.net'));
  });

  it('flags a real-looking IPv4 address', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'host: 203.0.113.42' }]);
    assert.ok(findings.some((f) => f.kind === 'ip' && f.match === '203.0.113.42'));
  });

  it('ignores boilerplate IPv4 addresses', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'bind 0.0.0.0, loopback 127.0.0.1' }]);
    assert.equal(findings.filter((f) => f.kind === 'ip').length, 0);
  });

  it('flags an internal-looking hostname', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'const host = "prod-db.internal.example.ru";' }]);
    assert.ok(findings.some((f) => f.kind === 'hostname' && f.match === 'prod-db.internal.example.ru'));
  });

  it('does not flag a filename that only looks domain-shaped', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: "import { x } from './utils.ts';" }]);
    assert.equal(findings.filter((f) => f.kind === 'hostname').length, 0);
  });

  it('does not flag a well-known public host', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'see https://docs.github.com/en/actions' }]);
    assert.equal(findings.filter((f) => f.kind === 'hostname').length, 0);
  });

  it('does not flag a code identifier from a pasted stack trace', () => {
    const findings = scanForLeaks([
      { source: 'a.ts', content: 'at Hooks.resolve (node:internal/modules/esm/hooks:240:30)' },
    ]);
    assert.equal(findings.filter((f) => f.kind === 'hostname').length, 0);
  });

  it('does not flag other capitalized method/property access patterns', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'Object.assign(target, Array.prototype)' }]);
    assert.equal(findings.filter((f) => f.kind === 'hostname').length, 0);
  });

  it('flags a high-entropy token', () => {
    const findings = scanForLeaks([
      { source: 'a.ts', content: 'const apiKey = "sk_live_9fJ3kLp0Qz7Xw2Bv8Yc1Nm4RtGh6Ae5D";' },
    ]);
    assert.ok(findings.some((f) => f.kind === 'token'));
  });

  it('does not flag an ordinary long camelCase identifier', () => {
    const findings = scanForLeaks([
      { source: 'a.ts', content: 'function generateKeyPairSyncWithDefaultOptionsAndPadding() {}' },
    ]);
    assert.equal(findings.filter((f) => f.kind === 'token').length, 0);
  });

  it('reports the correct line number', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'line one\nline two\ndev@example.com here' }]);
    const emailFinding = findings.find((f) => f.kind === 'email');
    assert.equal(emailFinding?.line, 3);
  });

  it('returns nothing for clean, already-anonymized content', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'const host = "{{DB_HOST}}"; // no secrets here' }]);
    assert.equal(findings.length, 0);
  });
});

describe('formatLeakFindings', () => {
  it('returns an empty string for no findings', () => {
    assert.equal(formatLeakFindings([]), '');
  });

  it('includes the count, source, line, and match', () => {
    const message = formatLeakFindings([{ source: 'src/a.ts', line: 3, kind: 'email', match: 'dev@example.com' }]);
    assert.match(message, /found 1 value/);
    assert.match(message, /src\/a\.ts:3/);
    assert.match(message, /dev@example\.com/);
  });

  it('truncates past the limit', () => {
    const findings = Array.from({ length: 25 }, (_, i) => ({
      source: 'a.ts',
      line: i + 1,
      kind: 'email' as const,
      match: `dev${i}@example.com`,
    }));
    const message = formatLeakFindings(findings, 20);
    assert.match(message, /and 5 more/);
  });
});
