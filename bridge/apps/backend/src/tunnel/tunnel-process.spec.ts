import { EventEmitter } from 'node:events';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import { TunnelProcess } from './tunnel-process';

const link = (host: string) =>
  `vless://11111111-2222-3333-4444-555555555555@${host}:443?security=reality&encryption=none&pbk=PUB&fp=chrome&sni=www.samsung.com&sid=ab&type=tcp`;

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  stderr = new EventEmitter();
  kill = jest.fn(() => {
    this.killed = true;
    this.exitCode = 0;

    return true;
  });
}

function setup(overrides: { ready?: boolean; now?: () => number } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tunnel-test-'));
  const children: FakeChild[] = [];
  const logs: string[] = [];
  const tunnel = new TunnelProcess({
    dir,
    port: 18999,
    xrayBin: 'xray',
    now: overrides.now,
    log: {
      info: (m) => logs.push(`info ${m}`),
      warn: (m) => logs.push(`warn ${m}`),
      error: (m) => logs.push(`error ${m}`),
    },
    spawnProcess: () => {
      const child = new FakeChild();

      children.push(child);

      return child as unknown as ChildProcess;
    },
    waitForPort: async () => overrides.ready ?? true,
  });

  return { tunnel, children, logs, dir };
}

describe('TunnelProcess', () => {
  it('starts xray once for a pool and keeps it while the pool is the same', async () => {
    const { tunnel, children, dir } = setup();

    expect(await tunnel.apply([link('a.example')])).toBe(
      'http://127.0.0.1:18999',
    );
    expect(await tunnel.apply([link('a.example')])).toBe(
      'http://127.0.0.1:18999',
    );
    expect(children).toHaveLength(1);
    expect(tunnel.linkCount).toBe(1);
    expect(existsSync(path.join(dir, 'xray-bridge-tunnel.json'))).toBe(true);

    tunnel.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('restarts for another pool and stops for none', async () => {
    const { tunnel, children } = setup();

    await tunnel.apply([link('a.example')]);
    await tunnel.apply([link('a.example'), link('b.example')]);

    expect(children).toHaveLength(2);
    expect(children[0].kill).toHaveBeenCalled();
    expect(tunnel.linkCount).toBe(2);

    expect(await tunnel.apply([])).toBeNull();
    expect(children[1].kill).toHaveBeenCalled();
    expect(tunnel.linkCount).toBe(0);
  });

  it('leaves out a link that cannot be used, and fails when none can', async () => {
    const { tunnel, children, logs } = setup();

    expect(await tunnel.apply(['garbage', link('a.example')])).not.toBeNull();
    expect(tunnel.linkCount).toBe(2);
    expect(logs.some((l) => l.includes('left out'))).toBe(true);

    const none = setup();

    expect(await none.tunnel.apply(['garbage'])).toBeNull();
    expect(none.children).toHaveLength(0);
    expect(children).toHaveLength(1);
  });

  it('does not keep restarting a pool that keeps failing: it backs off', async () => {
    let clock = 1_000_000;
    const { tunnel, children } = setup({ ready: false, now: () => clock });

    expect(await tunnel.apply([link('a.example')])).toBeNull();
    expect(await tunnel.apply([link('a.example')])).toBeNull();
    expect(children).toHaveLength(1);

    clock += 31_000;

    expect(await tunnel.apply([link('a.example')])).toBeNull();
    expect(children).toHaveLength(2);
  });

  it('says the binary is missing once and stops trying', async () => {
    const { tunnel, children, logs } = setup({ ready: false });

    const pending = tunnel.apply([link('a.example')]);

    children[0].emit(
      'error',
      Object.assign(new Error('spawn xray ENOENT'), { code: 'ENOENT' }),
    );
    await pending;

    expect(tunnel.isMissing).toBe(true);
    expect(logs.filter((l) => l.includes('not installed'))).toHaveLength(1);

    expect(await tunnel.apply([link('a.example')])).toBeNull();
    expect(children).toHaveLength(1);
  });

  it('starts again after the process died', async () => {
    let clock = 1_000_000;
    const { tunnel, children } = setup({ now: () => clock });

    await tunnel.apply([link('a.example')]);
    children[0].exitCode = 1;
    children[0].emit('exit', 1);

    clock += 31_000;

    expect(await tunnel.apply([link('a.example')])).toBe(
      'http://127.0.0.1:18999',
    );
    expect(children).toHaveLength(2);
  });
});
