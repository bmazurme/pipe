// Stands in for worker in the end-to-end test of the closed-contour link
// (SELF_IMPROVEMENT_PLAN.md stage 2): uploads a *result* parcel for a pushed
// task so the autopilot's auto-pull can be verified without a real (paid)
// Claude run.
//
//   npx tsx --env-file=.env scripts/fake-result-parcel.ts 9001:m-xxxx
//
// It takes the task's own outbound parcel contents as they exist locally,
// anonymizes them the same way push does, adds src/farewell.ts, and uploads
// the result with channel=issue / direction=result / taskKey — exactly the
// addressing worker uses for a real result.
import { readFileSync } from 'fs';
import { join } from 'path';

import { getSubscriptionConfig, findTrackedProject } from '../src/subscription/config-props';
import { getIssueState } from '../src/subscription/state-props';
import { walkProjectFiles } from '../src/subscription/walk';
import { applyDictionary } from '../src/subscription/dictionary';
import { buildArchive } from '../src/subscription/pack';
import { uploadParcel } from '../src/subscription/bridge-client';

const taskKey = process.argv[2];

if (!taskKey || !taskKey.includes(':')) {
  console.error('usage: fake-result-parcel.ts <projectId>:<iid>');
  process.exit(1);
}

const [projectId, iid] = taskKey.split(':');
const project = findTrackedProject(projectId);
const state = getIssueState(projectId, iid);

if (!project || !state?.branch) {
  console.error(`Task ${taskKey} is not tracked/initialised in this reports instance`);
  process.exit(1);
}

const { dictionary } = getSubscriptionConfig();
const relPaths = await walkProjectFiles(project);
const files = relPaths.map((relPath) => ({
  relPath,
  content: applyDictionary(readFileSync(join(project.path, relPath), 'utf-8'), dictionary, 'toRemote'),
}));

// The "work" worker would have done — written in terms of the *anonymized*
// text (it contains the placeholder), so a correct pull must turn it back
// into the real value locally.
files.push({
  relPath: 'src/farewell.ts',
  content: "// Added by the fake worker.\nexport function farewell(name: string): string {\n  return `Goodbye, ${name}! — COMPANY_X`;\n}\n",
});

const archive = buildArchive(files, {
  issueId: iid,
  issueIid: iid,
  issueTitle: state.title ?? '',
  issueDescription: state.description ?? '',
  projectId: Number(projectId),
  branch: state.branch,
  createdAt: new Date().toISOString(),
});

const stored = await uploadParcel(archive, `${projectId}-${iid}.subscription.zip`, {
  channel: 'issue',
  taskKey,
  direction: 'result',
});

console.log(`Uploaded result parcel #${stored.id} for ${taskKey} (${files.length} files)`);
