import { useCallback, useState } from 'react';
import type { ConnectionCheckResultType, ConnectionCheckTarget, SettingsType } from '@reports/shared';

import { useCheckConnectionMutation } from '../../store/api';
import { describeError } from '../../utils/describe-error';

export const CHECK_TARGETS: ConnectionCheckTarget[] = ['gitlab', 'github', 'bridge'];

// The form fields a check depends on. A result is only shown while these are unchanged, so a
// green tick never outlives the values it was obtained with.
const inputsOf: Record<ConnectionCheckTarget, (s: SettingsType) => string> = {
  gitlab: (s) => [s.gitlabUrl, s.privateToken, s.userId].join('\n'),
  github: () => '',
  bridge: (s) => [s.bridgeApiUrl, s.bridgeApiKey, s.bridgeStorageApiKey].join('\n'),
};

export type CheckState = {
  loading: boolean;
  // Present once a check finished; `stale` = the form changed after it ran.
  result?: ConnectionCheckResultType;
  error?: string;
  stale: boolean;
};

type Stored = { inputs: string; loading: boolean; result?: ConnectionCheckResultType; error?: string };

export function useConnectionChecks(form: SettingsType) {
  const [check] = useCheckConnectionMutation();
  const [stored, setStored] = useState<Partial<Record<ConnectionCheckTarget, Stored>>>({});

  const run = useCallback(async (target: ConnectionCheckTarget) => {
    const inputs = inputsOf[target](form);

    setStored((prev) => ({ ...prev, [target]: { inputs, loading: true } }));

    try {
      const result = await check({ target, settings: form }).unwrap();

      setStored((prev) => ({ ...prev, [target]: { inputs, loading: false, result } }));
    } catch (error) {
      setStored((prev) => ({ ...prev, [target]: { inputs, loading: false, error: describeError(error) } }));
    }
  }, [check, form]);

  const runAll = useCallback(() => Promise.all(CHECK_TARGETS.map(run)), [run]);

  const stateOf = (target: ConnectionCheckTarget): CheckState => {
    const entry = stored[target];

    if (!entry) return { loading: false, stale: false };

    return {
      loading: entry.loading,
      result: entry.result,
      error: entry.error,
      stale: entry.inputs !== inputsOf[target](form),
    };
  };

  return { run, runAll, stateOf, anyLoading: CHECK_TARGETS.some((t) => stored[t]?.loading) };
}
