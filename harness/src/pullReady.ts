import { DEFAULT_ACTION_DEPS, runAction, type ActionDeps, type ActionResult } from './actions.js';
import type { LiveStatusResult } from './bridgeLive.js';
import type { AnnotatedTaskEntry } from './deriveStatus.js';
import { pullableKeys } from './next.js';

export interface PullReadyOptions {
  yes: boolean;
  dryRun: boolean;
  project?: string;
}

// --pull-ready: pulls every task bridge confirms has a result, behind ONE
// confirmation. Pulls run sequentially — each pull-issue checks the git tree
// and writes into the same project tree. A failure doesn't stop the rest.
export async function runPullReady(
  tasks: AnnotatedTaskEntry[],
  liveResult: LiveStatusResult | undefined,
  options: PullReadyOptions,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): Promise<ActionResult> {
  if (!liveResult?.available) {
    return { code: 1, output: `Bridge live check unavailable: ${liveResult?.reason ?? 'no live data'}` };
  }

  const keys = pullableKeys(tasks, liveResult.data.tasks);
  if (keys.length === 0) return { code: 0, output: 'Nothing ready to pull.' };

  const actionOptions = { yes: true, dryRun: options.dryRun, project: options.project };

  if (options.dryRun) {
    const lines: string[] = [];
    let code = 0;
    for (const key of keys) {
      const result = await runAction('pull', key, actionOptions, deps);
      lines.push(result.output || `Would pull ${key}.`);
      if (result.code !== 0) code = 1;
    }
    return { code, output: lines.join('\n') };
  }

  const list = `${keys.length} ready result(s): ${keys.join(', ')}`;
  if (!options.yes) {
    if (!deps.isInteractive) {
      return { code: 1, output: `Refusing to pull ${list} without confirmation in a non-interactive session — pass --yes.` };
    }
    if (!(await deps.confirm(`About to pull ${list}. Proceed?`))) {
      return { code: 1, output: 'Aborted.' };
    }
  }

  const failed: string[] = [];
  let pulled = 0;
  for (const key of keys) {
    const result = await runAction('pull', key, actionOptions, deps);
    if (result.output) console.log(result.output);
    if (result.code === 0) pulled++;
    else failed.push(key);
  }

  return {
    code: failed.length > 0 ? 1 : 0,
    output: `pulled ${pulled}, failed ${failed.length}${failed.length > 0 ? ` (${failed.join(', ')})` : ''}`,
  };
}
