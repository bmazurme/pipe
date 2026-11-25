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

  it('reports an email once, without a hostname finding for its domain', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'a@corp.internal' }]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, 'email');
  });

  it('still reports a standalone hostname on the same line as an email', () => {
    const findings = scanForLeaks([{ source: 'a.ts', content: 'a@corp.internal via db.corp.internal' }]);
    assert.deepEqual(
      findings.map((f) => [f.kind, f.match]),
      [['email', 'a@corp.internal'], ['hostname', 'db.corp.internal']],
    );
  });

  it('reports correct line numbers on a multi-line sample', () => {
    const content = 'line one\nip 203.0.113.42\n\nhost prod-db.internal.example.ru\nmail a@corp.internal';
    const findings = scanForLeaks([{ source: 'a.ts', content }]);
    const lineOf = (kind: string) => findings.find((f) => f.kind === kind)?.line;
    assert.equal(lineOf('ip'), 2);
    assert.equal(lineOf('hostname'), 4);
    assert.equal(lineOf('email'), 5);
  });

  it('scans a large input with many matches in bounded time', () => {
    const content = 'host-a.internal.example.ru\n'.repeat(50000);
    const start = Date.now();
    const findings = scanForLeaks([{ source: 'big.txt', content }]);
    assert.equal(findings.length, 50000);
    assert.equal(findings[49999].line, 50000);
    assert.ok(Date.now() - start < 5000);
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

describe('scanForLeaks — secret assignments and URL credentials', () => {
  const scan = (content: string) => scanForLeaks([{ source: 'a.env', content }]);

  it('flags short password/secret assignments once, masked', () => {
    for (const [content, masked] of [
      ['DB_PASSWORD=Winter2024!', 'DB_PASSWORD=W***'],
      ['password: "hunter2"', 'password=h***'],
      ['{\n  "apiSecret": "letmein-prod"\n}', 'apiSecret=l***'],
    ]) {
      const secrets = scan(content).filter((f) => f.kind === 'secret');
      assert.equal(secrets.length, 1, content);
      assert.equal(secrets[0].match, masked);
    }
    assert.equal(scan('x\n\nDB_PASSWORD=Winter2024!').find((f) => f.kind === 'secret')?.line, 3);
  });

  it('flags URL credentials as a secret, not an email', () => {
    const findings = scan('https://deploy:S3cret@github.com/x.git');
    assert.equal(findings.filter((f) => f.kind === 'secret').length, 1);
    assert.equal(findings.filter((f) => f.kind === 'email').length, 0);
    assert.ok(!findings.some((f) => f.match.includes('S3cret')));
  });

  it('ignores every kind of placeholder value, in assignments and in URL credentials', () => {
    for (const content of [
      'password: $(cat /run/secrets/db)',
      'password: {{ db_password }}',
      'password: [[vault]]',
      'password: %(db_password)s',
      'password = os.environ["DB_PASSWORD"]',
      'secret: env.SECRET',
      'password: changeme',
      'password: string',
      'token: undefined',
      'password: xxxxxx',
      'password: ******',
      'https://deploy:${CI_JOB_TOKEN}@github.com/x.git',
      'https://deploy:<PASSWORD>@github.com/x.git',
    ]) {
      assert.equal(scan(content).filter((f) => f.kind === 'secret').length, 0, content);
    }
  });

  it('reports a URL credential and a plain assignment on the same line separately, each with a masked value', () => {
    const findings = scan('PROXY=http://u:Tr0ub4dor@proxy.example.com DB_PASSWORD=Winter2024! owner=ops@corp-mail.test');
    const secrets = findings.filter((f) => f.kind === 'secret');
    assert.equal(secrets.length, 2);
    assert.equal(findings.filter((f) => f.kind === 'email').length, 1);
    assert.ok(!findings.some((f) => f.kind === 'hostname' && f.match.includes('proxy.example.com')));
    assert.ok(secrets.every((f) => !f.match.includes('Tr0ub4dor') && !f.match.includes('Winter2024')));
  });

  it('ignores placeholders and identifiers', () => {
    for (const content of [
      'password: ${DB_PASSWORD}',
      'token: <TOKEN_1>',
      'apiKey = process.env.API_KEY',
      'password=',
      'const x = passwordInput',
    ]) {
      assert.equal(scan(content).filter((f) => f.kind === 'secret').length, 0, content);
    }
  });
});
