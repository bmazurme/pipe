import { ConflictException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  ALERT_AFTER_FAILURES,
  LOCK_AFTER_FAILURES,
  RECOVERY_CODE_COUNT,
  StepUpService,
} from './step-up.service';
import { totpAt } from './totp';

// Just enough of the two repositories for the service, kept in memory so the claims ("this step is spent",
// "this recovery code is spent") behave like the real UPDATE ... WHERE statements.
function makeRepos() {
  const totpRows: any[] = [];
  const codeRows: any[] = [];
  let nextId = 1;

  const totps = {
    findOne: jest.fn(
      async ({ where }: any) =>
        totpRows.find((r) => r.userId === where.userId) ?? null,
    ),
    create: jest.fn((row: any) => ({ ...row })),
    save: jest.fn(async (row: any) => {
      totpRows.push({ id: nextId++, ...row });
    }),
    update: jest.fn(async (id: number, patch: any) => {
      Object.assign(
        totpRows.find((r) => r.id === id),
        patch,
      );
    }),
    delete: jest.fn(async ({ userId }: any) => {
      for (let i = totpRows.length - 1; i >= 0; i--)
        if (totpRows[i].userId === userId) totpRows.splice(i, 1);
    }),
    createQueryBuilder: jest.fn(() => {
      let patch: any;
      let params: any;

      const qb: any = {
        update: () => qb,
        set: (p: any) => ((patch = p), qb),
        where: (_sql: string, p: any) => ((params = p), qb),
        execute: async () => {
          const row = totpRows.find(
            (r) => r.userId === params.userId && r.lastStep < params.step,
          );

          if (row) Object.assign(row, patch);

          return { affected: row ? 1 : 0 };
        },
      };

      return qb;
    }),
  };

  const codes = {
    count: jest.fn(
      async ({ where }: any) =>
        codeRows.filter((r) => r.userId === where.userId && r.usedAt === null)
          .length,
    ),
    create: jest.fn((row: any) => ({ ...row })),
    save: jest.fn(async (rows: any[]) => {
      for (const row of rows) codeRows.push({ id: nextId++, ...row });
    }),
    delete: jest.fn(async ({ userId }: any) => {
      for (let i = codeRows.length - 1; i >= 0; i--)
        if (codeRows[i].userId === userId) codeRows.splice(i, 1);
    }),
    createQueryBuilder: jest.fn(() => {
      let patch: any;
      let params: any;

      const qb: any = {
        update: () => qb,
        set: (p: any) => ((patch = p), qb),
        where: (_sql: string, p: any) => ((params = p), qb),
        execute: async () => {
          const row = codeRows.find(
            (r) =>
              r.userId === params.userId &&
              r.codeHash === params.hash &&
              r.usedAt === null,
          );

          if (row) Object.assign(row, patch);

          return { affected: row ? 1 : 0 };
        },
      };

      return qb;
    }),
  };

  return { totps, codes, totpRows, codeRows };
}

function setup(env: Record<string, string> = {}) {
  const repos = makeRepos();
  const notify = { send: jest.fn().mockResolvedValue(true) };
  const logs = { record: jest.fn().mockResolvedValue(undefined) };
  const jwt = new JwtService({ secret: 'test-secret' });
  const users = {
    findById: jest.fn().mockResolvedValue({ id: 1, email: 'me@example.com' }),
  };
  const config = { get: (key: string) => env[key] };
  const service = new StepUpService(
    repos.totps as any,
    repos.codes as any,
    jwt,
    users as any,
    config as any,
    notify as any,
    logs as any,
  );

  return { service, repos, notify, logs, jwt };
}

// Moves the clock so each test can use a fresh TOTP step.
let clock = 1_700_000_000_000;

beforeEach(() => {
  clock += 10 * 60_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => jest.restoreAllMocks());

async function enrolled(env?: Record<string, string>) {
  const ctx = setup(env);
  const { secret } = await ctx.service.setup(1);
  const recoveryCodes = await ctx.service.enable(1, totpAt(secret, clock));

  clock += 60_000; // the first code is spent; the next action uses a later step

  return { ...ctx, secret, recoveryCodes };
}

describe('StepUpService enrolment', () => {
  it('starts disabled, and a setup alone protects nothing', async () => {
    const { service } = setup();

    await service.setup(1);

    expect(await service.isEnabled(1)).toBe(false);
    expect(await service.status(1)).toMatchObject({
      enabled: false,
      setupPending: true,
    });
  });

  it('returns an otpauth link naming the account', async () => {
    const { service } = setup();
    const { secret, otpauthUri } = await service.setup(1);

    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(otpauthUri).toContain('me%40example.com');
  });

  it('turns on with the first valid code and hands out ten recovery codes once', async () => {
    const { service, recoveryCodes, notify } = await enrolled();

    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(await service.status(1)).toMatchObject({
      enabled: true,
      recoveryCodesLeft: RECOVERY_CODE_COUNT,
    });
    expect(notify.send).toHaveBeenCalledWith(
      expect.stringContaining('включена'),
      { urgent: true },
    );
  });

  it('refuses a wrong first code and does not turn on', async () => {
    const { service } = setup();

    await service.setup(1);

    await expect(service.enable(1, '000000')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(await service.isEnabled(1)).toBe(false);
  });

  it('refuses to start over while it is on', async () => {
    const { service } = await enrolled();

    await expect(service.setup(1)).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores recovery codes only as hashes', async () => {
    const { repos, recoveryCodes } = await enrolled();

    for (const row of repos.codeRows) {
      expect(recoveryCodes).not.toContain(row.codeHash);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('StepUpService grants', () => {
  it('exchanges a valid code for a grant bound to the user and the session', async () => {
    const { service, secret } = await enrolled();
    const { token } = await service.issueGrant(1, 7, totpAt(secret, clock));

    expect(service.checkGrant(token, 1, 7)).toBe(true);
    expect(service.checkGrant(token, 2, 7)).toBe(false);
    expect(service.checkGrant(token, 1, 8)).toBe(false);
  });

  it('refuses a grant after five minutes', async () => {
    const { service, secret } = await enrolled();
    const { token } = await service.issueGrant(1, 7, totpAt(secret, clock));

    jest.useFakeTimers({
      now: Date.now() + 6 * 60_000,
      doNotFake: ['nextTick', 'setImmediate'],
    });
    expect(service.checkGrant(token, 1, 7)).toBe(false);
    jest.useRealTimers();
  });

  it('does not accept an access token or garbage as a grant', async () => {
    const { service, jwt } = await enrolled();
    const login = jwt.sign({ sub: 1, sessionId: 7 });

    expect(service.checkGrant(login, 1, 7)).toBe(false);
    expect(service.checkGrant('nonsense', 1, 7)).toBe(false);
  });

  it('refuses the same code twice (replay)', async () => {
    const { service, secret } = await enrolled();
    const code = totpAt(secret, clock);

    await service.issueGrant(1, 7, code);

    await expect(service.issueGrant(1, 7, code)).rejects.toMatchObject({
      response: { code: 'STEP_UP_INVALID_CODE' },
    });
  });

  it('answers a wrong code with 403, never 401 (a 401 would make the browser refresh and retry)', async () => {
    const { service } = await enrolled();

    await expect(service.issueGrant(1, 7, '123456')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('is a conflict when two-factor is not on', async () => {
    const { service } = setup();

    await expect(service.issueGrant(1, 7, '123456')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('StepUpService recovery codes', () => {
  it('accepts a recovery code once, writes it down and alerts', async () => {
    const { service, recoveryCodes, notify, logs } = await enrolled();

    await expect(
      service.issueGrant(1, 7, recoveryCodes[0]),
    ).resolves.toHaveProperty('token');
    expect(notify.send).toHaveBeenCalledWith(
      expect.stringContaining('Использован код восстановления'),
      { urgent: true },
    );
    expect(logs.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stepup.recovery_used' }),
    );
    expect((await service.status(1)).recoveryCodesLeft).toBe(
      RECOVERY_CODE_COUNT - 1,
    );

    await expect(
      service.issueGrant(1, 7, recoveryCodes[0]),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('takes the code typed in capitals and with spaces', async () => {
    const { service, recoveryCodes } = await enrolled();

    await expect(
      service.issueGrant(
        1,
        7,
        recoveryCodes[1].toUpperCase().replace(/-/g, ' '),
      ),
    ).resolves.toBeDefined();
  });

  it('replaces the set when asked with a valid code', async () => {
    const { service, secret, recoveryCodes } = await enrolled();
    const fresh = await service.regenerateRecoveryCodes(
      1,
      totpAt(secret, clock),
    );

    expect(fresh).toHaveLength(RECOVERY_CODE_COUNT);
    expect(fresh).not.toEqual(recoveryCodes);
    await expect(
      service.issueGrant(1, 7, recoveryCodes[2]),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('StepUpService failures', () => {
  it('alerts on the third wrong code in a row, once', async () => {
    const { service, notify } = await enrolled();
    notify.send.mockClear();

    for (let i = 0; i < ALERT_AFTER_FAILURES; i++) {
      await service.issueGrant(1, 7, '000000').catch(() => undefined);
    }

    expect(notify.send).toHaveBeenCalledTimes(1);
    expect(notify.send).toHaveBeenCalledWith(
      expect.stringContaining('неверных кода'),
      { urgent: true },
    );
  });

  it('locks after five and refuses even a right code until the lock runs out', async () => {
    const { service, secret } = await enrolled();

    for (let i = 0; i < LOCK_AFTER_FAILURES; i++) {
      await service.issueGrant(1, 7, '000000').catch(() => undefined);
    }

    await expect(
      service.issueGrant(1, 7, totpAt(secret, clock)),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'STEP_UP_LOCKED' },
    });

    clock += 6 * 60_000;

    await expect(
      service.issueGrant(1, 7, totpAt(secret, clock)),
    ).resolves.toHaveProperty('token');
  });

  it('a right code resets the count', async () => {
    const { service, secret, notify } = await enrolled();
    notify.send.mockClear();

    await service.issueGrant(1, 7, '000000').catch(() => undefined);
    await service.issueGrant(1, 7, '000000').catch(() => undefined);
    await service.issueGrant(1, 7, totpAt(secret, clock));
    clock += 60_000;
    await service.issueGrant(1, 7, '000000').catch(() => undefined);
    await service.issueGrant(1, 7, '000000').catch(() => undefined);

    expect(notify.send).not.toHaveBeenCalled();
  });

  it('never writes a code or a token to the audit log', async () => {
    const { service, secret, logs } = await enrolled();
    const code = totpAt(secret, clock);
    const { token } = await service.issueGrant(1, 7, code);

    await service.issueGrant(1, 7, '654321').catch(() => undefined);

    const written = JSON.stringify(logs.record.mock.calls);

    expect(written).not.toContain(code);
    expect(written).not.toContain(token);
    expect(written).not.toContain('654321');
  });
});

describe('StepUpService disable', () => {
  it('turns off with a valid code, drops every row and raises an alert', async () => {
    const { service, secret, repos, notify } = await enrolled();

    await service.disable(1, totpAt(secret, clock));

    expect(await service.isEnabled(1)).toBe(false);
    expect(repos.totpRows).toHaveLength(0);
    expect(repos.codeRows).toHaveLength(0);
    expect(notify.send).toHaveBeenCalledWith(
      expect.stringContaining('выключена'),
      { urgent: true },
    );
  });

  it('does nothing with a wrong code', async () => {
    const { service } = await enrolled();

    await expect(service.disable(1, '000000')).rejects.toMatchObject({
      status: 403,
    });
    expect(await service.isEnabled(1)).toBe(true);
  });
});

describe('StepUpService enforcement flag', () => {
  it('is off unless STEP_UP_ENFORCE=true', () => {
    expect(setup().service.enforced()).toBe(false);
    expect(setup({ STEP_UP_ENFORCE: 'true' }).service.enforced()).toBe(true);
    expect(setup({ STEP_UP_ENFORCE: '1' }).service.enforced()).toBe(false);
  });
});
