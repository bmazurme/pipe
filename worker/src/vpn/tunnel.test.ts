import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import { VpnTunnel } from './tunnel.js';

const dir = mkdtempSync(path.join(tmpdir(), 'tunnel-'));

after(() => rmSync(dir, { recursive: true, force: true }));

const LINK = 'vless://u@vpn.example.com:443?security=reality&pbk=PUB&sni=www.example.org';
const OTHER = 'vless://u@other.example.com:443?security=reality&pbk=PUB&sni=www.example.org';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  stderr = new EventEmitter();
  signals: string[] = [];

  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    this.killed = true;
    this.exitCode = 0;
    this.emit('exit', 0);

    return true;
  }
}

function setup(opts: { ready?: boolean; fingerprint?: string; clock?: { t: number } } = {}) {
  const waits: number[] = [];
  const spawned: { bin: string; args: string[]; child: FakeChild }[] = [];
  const logs: string[] = [];
  const tunnel = new VpnTunnel({
    dir,
    xrayBin: 'xray-test',
    port: 19999,
    fingerprint: opts.fingerprint,
    log: { info: (_o, m) => logs.push(`info:${m}`), warn: (_o, m) => logs.push(`warn:${m}`), error: (_o, m) => logs.push(`error:${m}`) },
    spawnProcess: (bin, args) => {
      const child = new FakeChild();

      spawned.push({ bin, args, child });

      return child as unknown as ChildProcess;
    },
    waitForPort: async () => {
      waits.push(1);

      return opts.ready ?? true;
    },
    now: opts.clock ? () => opts.clock!.t : undefined,
  });

  return { tunnel, spawned, logs, waits };
}

describe('VpnTunnel', () => {
  it('starts xray with a private config for the link and answers with the local proxy', async () => {
    const { tunnel, spawned } = setup();

    assert.equal(await tunnel.apply(LINK), 'http://127.0.0.1:19999');
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].bin, 'xray-test');
    assert.deepEqual(spawned[0].args.slice(0, 2), ['run', '-config']);

    const configPath = spawned[0].args[2];

    assert.match(readFileSync(configPath, 'utf-8'), /vpn\.example\.com/);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);

    tunnel.stop();
    assert.equal(existsSync(configPath), false);
  });

  it('writes the firefox fingerprint into the config by default, and the configured one when set', async () => {
    const fingerprintInConfig = (spawned: { args: string[] }[]) =>
      JSON.parse(readFileSync(spawned[0].args[2], 'utf-8')).outbounds[0].streamSettings.realitySettings.fingerprint;
    const chromeLink = LINK.replace('?', '?fp=chrome&');

    const byDefault = setup();

    await byDefault.tunnel.apply(chromeLink);
    assert.equal(fingerprintInConfig(byDefault.spawned), 'firefox');
    byDefault.tunnel.stop();

    const custom = setup({ fingerprint: 'link' });

    await custom.tunnel.apply(chromeLink);
    assert.equal(fingerprintInConfig(custom.spawned), 'chrome');
    custom.tunnel.stop();
  });

  it('keeps the running tunnel for the same link and restarts it for another', async () => {
    const { tunnel, spawned } = setup();

    await tunnel.apply(LINK);
    await tunnel.apply(LINK);
    assert.equal(spawned.length, 1);

    await tunnel.apply(OTHER);
    assert.equal(spawned.length, 2);
    assert.deepEqual(spawned[0].child.signals, ['SIGTERM']);
    tunnel.stop();
  });

  it('stops when the link is removed', async () => {
    const { tunnel, spawned } = setup();

    await tunnel.apply(LINK);
    assert.equal(await tunnel.apply(null), null);
    assert.deepEqual(spawned[0].child.signals, ['SIGTERM']);
    assert.equal(await tunnel.apply(''), null);
  });

  it('starts it again when the process died', async () => {
    const clock = { t: 0 };
    const { tunnel, spawned, logs } = setup({ clock });

    await tunnel.apply(LINK);
    spawned[0].child.exitCode = 1;
    spawned[0].child.emit('exit', 1);
    assert.ok(logs.includes('warn:vpn tunnel exited — it is started again on the next poll'));

    assert.equal(await tunnel.apply(LINK), null);
    assert.equal(spawned.length, 1);
    clock.t += 30_000;
    await tunnel.apply(LINK);
    assert.equal(spawned.length, 2);
    tunnel.stop();
  });

  it('gives no proxy, and says so, when the tunnel does not come up', async () => {
    const { tunnel, logs, spawned } = setup({ ready: false });

    assert.equal(await tunnel.apply(LINK), null);
    assert.ok(logs.includes('error:vpn tunnel did not come up'));
    assert.deepEqual(spawned[0].child.signals, ['SIGTERM']);
  });

  it('never throws for a link it cannot use', async () => {
    const { tunnel, spawned, logs } = setup();

    assert.equal(await tunnel.apply('not a link'), null);
    assert.equal(spawned.length, 0);
    assert.ok(logs.includes('error:vpn link from the Worker page cannot be used'));
  });

  describe('back-off', () => {
    it('does not spawn or wait again within the back-off, and logs once', async () => {
      const clock = { t: 1000 };
      const { tunnel, spawned, waits, logs } = setup({ ready: false, clock });

      assert.equal(await tunnel.apply(LINK), null);
      assert.equal(spawned.length, 1);
      assert.equal(waits.length, 1);

      clock.t += 29_999;
      assert.equal(await tunnel.apply(LINK), null);
      assert.equal(await tunnel.apply(LINK), null);
      assert.equal(spawned.length, 1);
      assert.equal(waits.length, 1);
      assert.equal(logs.filter((l) => l === 'warn:vpn tunnel failed recently — not restarting it yet').length, 1);
    });

    it('retries after retryAt with a doubling delay capped at 5 minutes', async () => {
      const clock = { t: 0 };
      const { tunnel, spawned } = setup({ ready: false, clock });
      const delays = [30_000, 60_000, 120_000, 240_000, 300_000, 300_000];
      let expected = 1;

      await tunnel.apply(LINK);

      for (const delay of delays) {
        clock.t += delay - 1;
        await tunnel.apply(LINK);
        assert.equal(spawned.length, expected);
        clock.t += 1;
        await tunnel.apply(LINK);
        expected += 1;
        assert.equal(spawned.length, expected);
      }
    });

    it('tries a different link at once', async () => {
      const clock = { t: 0 };
      const { tunnel, spawned } = setup({ ready: false, clock });

      await tunnel.apply(LINK);
      await tunnel.apply(OTHER);
      assert.equal(spawned.length, 2);
    });

    it('clears the back-off when the link is removed', async () => {
      const clock = { t: 0 };
      const { tunnel, spawned } = setup({ ready: false, clock });

      await tunnel.apply(LINK);
      await tunnel.apply(null);
      await tunnel.apply(LINK);
      assert.equal(spawned.length, 2);
    });

    it('a successful start clears the back-off', async () => {
      const clock = { t: 0 };
      const state = { ready: false };
      const spawned: FakeChild[] = [];
      const tunnel = new VpnTunnel({
        dir,
        port: 19999,
        spawnProcess: () => {
          const child = new FakeChild();

          spawned.push(child);

          return child as unknown as ChildProcess;
        },
        waitForPort: async () => state.ready,
        now: () => clock.t,
      });

      await tunnel.apply(LINK);
      clock.t += 30_000;
      state.ready = true;
      assert.equal(await tunnel.apply(LINK), 'http://127.0.0.1:19999');

      spawned[1].exitCode = 1;
      spawned[1].emit('exit', 1);
      // the failure count restarted at 1: back-off is 30 s, not 60 s
      clock.t += 30_000;
      assert.equal(await tunnel.apply(LINK), 'http://127.0.0.1:19999');
      assert.equal(spawned.length, 3);
      tunnel.stop();
    });
  });
});
