import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FusionClient, FusionRunResult } from './client.js';
import { FusionAddinError } from './client.js';
import { FusionNotConfiguredError } from './config.js';
import { runFusionCtl, type FusionCtlDeps } from './fusionctl.js';

function harness(client: Partial<FusionClient> | (() => never), files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, Buffer> = {};
  const deps: FusionCtlDeps = {
    client: typeof client === 'function' ? client : () => client as FusionClient,
    readFile: (file) => {
      if (!(file in files)) throw new Error(`ENOENT ${file}`);

      return files[file];
    },
    writeFile: (file, data) => {
      written[file] = data;
    },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };

  return { deps, out, err, written };
}

const ok: FusionRunResult = { ok: true, stdout: 'built\n', stderr: '', error: null, traceback: null, result: null };

describe('fusionctl', () => {
  it('prints the health of Fusion and of the design', async () => {
    const { deps, out } = harness({ health: async () => ({ ok: true, app: 'Fusion', version: '2', document: 'boat' }), info: async () => ({ bodies: 3 }) });

    assert.equal(await runFusionCtl(['health'], deps), 0);
    assert.equal(await runFusionCtl(['info'], deps), 0);
    assert.match(out[0], /"document": "boat"/);
    assert.match(out[1], /"bodies": 3/);
  });

  it('runs a script and reports OK with what it printed and returned', async () => {
    let seen: unknown[] = [];
    const { deps, out } = harness(
      {
        run: async (...args) => {
          seen = args;

          return { ...ok, result: { volume: 12.5 } };
        },
      },
      { 'cad/v1/hull.py': 'print(1)' },
    );

    assert.equal(await runFusionCtl(['run', 'cad/v1/hull.py', '--timeout', '60'], deps), 0);
    assert.deepEqual(seen, ['print(1)', 'hull.py', 60]);
    assert.deepEqual(out, ['built', 'result: {"volume":12.5}', 'OK']);
  });

  it('exits 1 with the error and traceback of a script that failed', async () => {
    const { deps, err } = harness(
      { run: async () => ({ ok: false, stdout: '', stderr: 'warn\n', error: 'RuntimeError: no sketch', traceback: 'Traceback...\n', result: null }) },
      { 's.py': 'x' },
    );

    assert.equal(await runFusionCtl(['run', 's.py'], deps), 1);
    assert.deepEqual(err, ['warn', 'FAILED: RuntimeError: no sketch', 'Traceback...']);
  });

  it('saves a screenshot with the chosen view and size, and an export in the chosen format', async () => {
    const calls: unknown[][] = [];
    const { deps, written, out } = harness({
      screenshot: async (...args) => {
        calls.push(args);

        return Buffer.from([9]);
      },
      export: async (format) => {
        calls.push([format]);

        return Buffer.from([8]);
      },
    });

    assert.equal(await runFusionCtl(['screenshot', 'out/a.png', '--view', 'front', '--size', '800x600'], deps), 0);
    assert.equal(await runFusionCtl(['screenshot', 'b.png'], deps), 0);
    assert.equal(await runFusionCtl(['export', 'step', 'hull.step'], deps), 0);
    assert.deepEqual(calls, [['front', 800, 600], ['iso', 1600, 1000], ['step']]);
    assert.deepEqual([...written['out/a.png']], [9]);
    assert.deepEqual([...written['hull.step']], [8]);
    assert.match(out[0], /saved out\/a\.png \(front view\)/);
  });

  it('exits 2 with the usage on a wrong command or arguments', async () => {
    for (const argv of [[], ['dance'], ['run'], ['run', 's.py', '--timeout', '0'], ['screenshot'], ['screenshot', 'a.png', '--view', 'up'], ['screenshot', 'a.png', '--size', 'big'], ['export', 'dwg', 'a'], ['export', 'step']]) {
      const { deps, err } = harness({});

      assert.equal(await runFusionCtl(argv, deps), 2, argv.join(' '));
      assert.match(err[0], /usage:/);
    }
  });

  it('exits 3 when Fusion cannot be reached, with a plain reason', async () => {
    const unreachable = harness({
      health: async () => {
        throw new FusionAddinError('Cannot reach the pipe add-in');
      },
    });
    const unconfigured = harness(() => {
      throw new FusionNotConfiguredError('no config');
    });
    const other = harness({
      info: async () => {
        throw new Error('weird');
      },
    });

    assert.equal(await runFusionCtl(['health'], unreachable.deps), 3);
    assert.match(unreachable.err[0], /Fusion 360 is not reachable: Cannot reach/);
    assert.equal(await runFusionCtl(['health'], unconfigured.deps), 3);
    assert.equal(await runFusionCtl(['info'], other.deps), 3);
    assert.match(other.err[0], /fusionctl: weird/);
  });
});

describe('fusionctl with its real dependencies', () => {
  it('reads the script and writes the files (creating the folder) and prints to the console', async () => {
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { mock } = await import('node:test');
    const { realDeps } = await import('./fusionctl.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'fusionctl-'));
    const logged: string[] = [];
    const errors: string[] = [];

    try {
      writeFileSync(path.join(dir, 's.py'), 'print(1)');
      assert.equal(realDeps.readFile(path.join(dir, 's.py')), 'print(1)');

      realDeps.writeFile(path.join(dir, 'a', 'b', 'out.bin'), Buffer.from([1, 2]));
      assert.deepEqual([...readFileSync(path.join(dir, 'a', 'b', 'out.bin'))], [1, 2]);

      mock.method(console, 'log', (text: string) => logged.push(text));
      mock.method(console, 'error', (text: string) => errors.push(text));
      realDeps.out('hello');
      realDeps.err('oops');
      assert.deepEqual([logged, errors], [['hello'], ['oops']]);

      // The client is built from the config file the add-in wrote.
      writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 47615, token: 'z'.repeat(32) }));
      const previous = process.env.PIPE_FUSION_CONFIG;

      process.env.PIPE_FUSION_CONFIG = path.join(dir, 'config.json');
      try {
        assert.ok(realDeps.client());
      } finally {
        if (previous === undefined) delete process.env.PIPE_FUSION_CONFIG;
        else process.env.PIPE_FUSION_CONFIG = previous;
      }
    } finally {
      mock.restoreAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
