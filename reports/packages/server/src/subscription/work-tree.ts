import { findMigration, findTrackedProject } from './config-props';

export function requireTrackedProject(projectId: string) {
  const trackedProject = findTrackedProject(projectId);

  if (!trackedProject) {
    throw new Error('Этот проект не отслеживается: добавьте локальный репозиторий в Settings → Отслеживаемые репозитории');
  }

  return trackedProject;
}

// The repository a task works in: for an ordinary one, its tracked project; for a migration task, the TARGET repository (the task
// branch is created there and the result unpacked there — the current repository is only ever read).
export function workTreeFor(projectId: string) {
  const migration = findMigration(projectId);

  if (migration) {
    return { path: migration.targetPath, baseBranch: migration.targetBaseBranch || 'main', migration };
  }

  const project = requireTrackedProject(projectId);

  return { path: project.path, baseBranch: project.baseBranch || 'main', migration: undefined };
}
