import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { SubscriptionStateEntryType } from '@reports/shared';
import { resolveInDir } from '@pipe/protocol/resolveInDir';

import { getSubscriptionConfig } from './config-props';
import { getIssueState, setIssueState } from './state-props';
import { workTreeFor } from './work-tree';
import { targetFilesOf } from './migration';
import { checkoutTaskBranch, commitPulledFiles, pushBranch } from './git';
import { applyDictionary } from './dictionary';
import { extractArchive } from './pack';
import { listParcels, peekParcel, deleteParcel } from './bridge-client';
import { decryptBuffer } from './encryption';

// A result parcel carries the whole tracked tree, almost all of it unchanged.
// Rewriting an identical file still bumps its mtime, which is not harmless:
// when the tracked repo is the one reports itself runs from, `tsx --watch`
// sees its own sources "change" and restarts the server in the middle of the
// pull — before the step is recorded — and the autopilot then pulls the same
// result again, forever. Only genuinely different files are written.
function writeIfChanged(destination: string, content: string): boolean {
  if (existsSync(destination) && readFileSync(destination, 'utf-8') === content) return false;

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, 'utf-8');

  return true;
}

function resolveParcelPath(projectRoot: string, relPath: string): string {
  try {
    return resolveInDir(projectRoot, relPath);
  } catch (error) {
    throw new Error(`Посылка содержит недопустимый путь: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Pulls the newest result parcel for one task into its local branch. Shared
// by the UI's Pull button and the background autopilot — both need exactly
// the same sequence (and the same keep-the-parcel-until-it-fully-worked
// guarantee), so it lives in one place rather than being copied.
//
// By default this only UNPACKS: the code lands in the working tree of the task's
// own branch and nothing is committed or pushed — the person looks it over and
// commits (or discards) it themselves. `publish: true` (the unattended
// autopilot, which has nobody to do that) also commits and pushes that one
// branch, never the target branch.
export async function pullSubscriptionIssue(
  projectId: string,
  iid: string,
  options: { publish?: boolean } = {},
): Promise<SubscriptionStateEntryType> {
  // The repository the result goes into: the tracked project's, or — for a migration task — the TARGET repository.
  const workTree = workTreeFor(projectId);
  // Matched by addressing metadata (IMPROVEMENTS_TECH.md 2.3), not by
  // filename — a filename-only match couldn't tell this task's *result*
  // apart from its own outbound parcel (push, above, uses the exact same
  // parcelName()), if the outbound one were ever still sitting in storage
  // (e.g. picked up by sync's agent-runner but somehow never consumed).
  const parcels = (await listParcels({ channel: 'issue', taskKey: `${projectId}:${iid}`, direction: 'result' }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const newest = parcels[0];

  if (!newest) {
    // Pull consumes the result from bridge, so a second Pull (or the UI's
    // button after the autopilot already pulled) finds nothing — say that
    // instead of sending the user off to push again.
    const done = getIssueState(projectId, iid);

    if (done?.pulledAt) {
      throw new Error(`Результат уже загружен (${done.pulledAt}) — повторно получать нечего`);
    }

    throw new Error('На bridge нет результата для этой задачи — дождитесь, пока worker его отправит');
  }

  const isEncrypted = newest.originalName.endsWith('.enc');
  const { dictionary, encryption } = getSubscriptionConfig();

  if (isEncrypted && !encryption.privateKey) {
    throw new Error('Посылка зашифрована, но приватный ключ не задан — вставьте его в Settings → Шифрование');
  }

  // peekParcel, not downloadParcel: everything from here down (decrypt,
  // extract, git checkout/write/commit/push) can still fail, and bridge's
  // /download route deletes server-side on success — doing that before
  // this risky work is what used to lose a parcel for good the moment
  // any later step failed (e.g. checkoutTaskBranch's dirty-tree guard
  // below), since nothing here persists the bytes anywhere else.
  // deleteParcel() only runs once every step below has actually
  // succeeded (see its own call further down).
  const downloaded = await peekParcel(newest.id);
  const buffer = isEncrypted ? decryptBuffer(downloaded, encryption.privateKey) : downloaded;
  const { manifest, files: parcelFiles, assets: parcelAssets } = extractArchive(buffer);
  // A migration result carries both repositories; only target/… is taken (with that prefix cut), the current repository is never
  // written, and the images sent along (screenshots) are not scattered into the target.
  const files = workTree.migration ? targetFilesOf(parcelFiles) : parcelFiles;
  // Files the person attached (issue-attachments/) are INPUT for the worker: the worker hands every asset back with its result, but
  // they are not part of it, and a .msg or .json with real data must not land in the repository (and in a commit of the autopilot).
  const assets = workTree.migration ? [] : parcelAssets.filter((asset) => !asset.relPath.startsWith('issue-attachments/'));
  const projectRoot = resolve(workTree.path);

  const state = getIssueState(projectId, iid);
  if (!state?.branch) {
    throw new Error('Сначала выполните init — ветка ещё не создана');
  }

  // Guarantees the write+commit below lands on the task branch, not
  // whatever the repo happened to be on (it can drift away from the task
  // branch between init and pull) — see checkoutTaskBranch's own comment.
  // Runs before the parcel is ever consumed from bridge (see above) — a
  // dirty tree now fails loudly with the parcel still safely pullable,
  // instead of silently losing it.
  const baseBranch = workTree.baseBranch;

  await checkoutTaskBranch(workTree.path, state.branch, baseBranch);

  // Every path is checked before the first one is written: a refused parcel
  // (one escaping the repo, or reaching into .git — the commit below would
  // run its hooks/config) must leave the tree clean, or checkoutTaskBranch's
  // dirty-tree guard would block every later pull.
  const fileDestinations = files.map((file) => resolveParcelPath(projectRoot, file.relPath));
  const assetDestinations = assets.map((asset) => resolveParcelPath(projectRoot, asset.relPath));

  let writtenFiles = 0;

  files.forEach((file, index) => {
    if (writeIfChanged(fileDestinations[index], applyDictionary(file.content, dictionary, 'toLocal'))) writtenFiles += 1;
  });

  // Images extracted from the issue description — written next to the code
  // so a human picking up the branch can actually see what the issue showed.
  assets.forEach((asset, index) => {
    mkdirSync(dirname(assetDestinations[index]), { recursive: true });
    writeFileSync(assetDestinations[index], Buffer.from(asset.base64, 'base64'));
  });

  // Only the unattended autopilot commits and pushes (the task branch only — never the target branch). A person's Pull
  // stops here: the files are in the working tree for them to review, commit or throw away.
  if (options.publish) {
    const title = applyDictionary(manifest.issueTitle, dictionary, 'toLocal');
    const relPaths = [...files.map((file) => file.relPath), ...assets.map((asset) => asset.relPath)];

    await commitPulledFiles(workTree.path, relPaths, `Pull issue #${iid}: ${title}`);
    await pushBranch(workTree.path, state.branch, baseBranch);
  }

  // The step is recorded the moment the content is safely written (and, for the autopilot, committed and
  // pushed) — before the parcel is touched. If the process dies (or is
  // restarted by a file watcher) anywhere after this point, the task is
  // already `pulled` and the autopilot won't pull the same result again.
  const pulledState = setIssueState(projectId, iid, { step: 'pulled', pulledAt: new Date().toISOString(), encrypted: isEncrypted, pulledFiles: writtenFiles + assets.length });

  // This is the one call allowed to consume the parcel from bridge. A
  // failure here is deliberately non-fatal: the pull itself already fully
  // succeeded, so leaving a now-redundant copy sitting in storage is
  // harmless clutter, not a reason to report the whole pull as failed.
  try {
    await deleteParcel(newest.id);
  } catch (error) {
    console.warn(`Failed to delete consumed parcel ${newest.id} from bridge storage:`, error);
  }

  return pulledState;
}
