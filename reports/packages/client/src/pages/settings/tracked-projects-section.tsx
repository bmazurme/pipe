import { useState } from 'react';
import {
  Alert, Button, TextInput, Text, Icon, Dialog, DialogHeader, DialogBody, DialogFooter, useToaster,
} from '@gravity-ui/uikit';
import { Plus, TrashBin } from '@gravity-ui/icons';
import type { TrackedProjectType } from '@reports/shared';

import {
  useGetSubscriptionConfigQuery,
  useAddTrackedProjectMutation,
  useRemoveTrackedProjectMutation,
} from '../../store/api';
import { describeError } from '../../utils/describe-error';

import style from './settings.module.css';

// Same pattern the server's resolveTrackedProject enforces.
const GITHUB_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

const emptyForm = { gitlabProjectId: '', githubRepo: '', githubLabel: '', path: '', baseBranch: '', include: '', exclude: '' };

function splitList(value: string): string[] | undefined {
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);

  return items.length ? items : undefined;
}

function TrackedProjectsSection() {
  const toaster = useToaster();
  const { data: config } = useGetSubscriptionConfigQuery();
  const [addTrackedProject, { isLoading: isAdding }] = useAddTrackedProjectMutation();
  const [removeTrackedProject] = useRemoveTrackedProjectMutation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [addError, setAddError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<TrackedProjectType | null>(null);

  const trackedProjects = config?.trackedProjects ?? [];
  // A GitHub repo replaces the GitLab id: the server resolves the repo's
  // numeric id from 'owner/name' when it is added.
  const isGithub = Boolean(form.githubRepo.trim());
  const isDuplicate = isGithub
    ? trackedProjects.some((project) => project.githubRepo?.toLowerCase() === form.githubRepo.trim().toLowerCase())
    : Boolean(form.gitlabProjectId) && trackedProjects.some((project) => project.gitlabProjectId === form.gitlabProjectId);
  const isGithubFormatInvalid = isGithub && !GITHUB_REPO_PATTERN.test(form.githubRepo.trim());
  const isValid = (isGithub || Boolean(form.gitlabProjectId)) && Boolean(form.path) && !isDuplicate && !isGithubFormatInvalid;

  const updateForm = (patch: Partial<typeof emptyForm>) => {
    setAddError(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const closeDialog = () => {
    if (isAdding) {
      return;
    }

    setIsDialogOpen(false);
    setAddError(null);
  };

  const handleAdd = async () => {
    if (!isValid || isAdding) {
      return;
    }

    const project: TrackedProjectType = {
      gitlabProjectId: isGithub ? '' : form.gitlabProjectId,
      ...(isGithub ? { provider: 'github' as const, githubRepo: form.githubRepo.trim(), githubLabel: form.githubLabel.trim() || undefined } : {}),
      path: form.path,
      baseBranch: form.baseBranch || undefined,
      include: splitList(form.include),
      exclude: splitList(form.exclude),
    };

    setAddError(null);

    try {
      await addTrackedProject(project).unwrap();
      setIsDialogOpen(false);
      setForm(emptyForm);
    } catch (error) {
      setAddError(describeError(error));
    }
  };

  const handleRemove = async () => {
    const project = toRemove;

    setToRemove(null);

    if (!project) {
      return;
    }

    try {
      await removeTrackedProject({ gitlabProjectId: project.gitlabProjectId }).unwrap();
    } catch (error) {
      toaster.add({
        name: 'tracked-project-remove-error',
        theme: 'danger',
        title: 'Не удалось удалить репозиторий',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  return (
    <>
      <section className={style.codes}>
        <div className={style.sectionHead}>
          <Text variant="subheader-2">Отслеживаемые репозитории</Text>
          <Text variant="caption-2" color="secondary">
            Локальные пути для init/push/pull в модуле Subscription — код проекта как в «Коды проектов»
          </Text>
        </div>
        {trackedProjects.length === 0 ? (
          <Text variant="body-2" color="secondary" className={style.codesEmpty}>
            Репозитории ещё не добавлены
          </Text>
        ) : (
          <ul className={style.codesList}>
            {trackedProjects.map((project) => (
              <li key={project.gitlabProjectId} className={style.codesItem}>
                <span className={style.codesCode}>{project.provider === 'github' ? project.githubRepo : project.gitlabProjectId}</span>
                <span className={style.codesLabel}>
                  {project.path}{project.baseBranch ? ` · ${project.baseBranch}` : ''}
                </span>
                <Button
                  view="flat"
                  size="s"
                  onClick={() => setToRemove(project)}
                  aria-label={`Удалить репозиторий ${project.gitlabProjectId}`}
                  className={style.codesRemove}
                >
                  <Icon data={TrashBin} size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button view="outlined" size="m" width="max" onClick={() => setIsDialogOpen(true)} className={style.codesAdd}>
          <Icon data={Plus} size={16} />
          Добавить репозиторий
        </Button>
      </section>

      <Dialog open={isDialogOpen} onClose={closeDialog}>
        <DialogHeader caption="Добавить отслеживаемый репозиторий" />
        <DialogBody>
          {addError && (
            <Alert theme="danger" title="Не удалось добавить репозиторий" message={addError} className={style.codesAlert} />
          )}
          <div className={style.codeForm}>
            <TextInput
              label="Код проекта GitLab"
              placeholder="ID проекта, как в «Коды проектов»"
              value={form.gitlabProjectId}
              onUpdate={(gitlabProjectId) => updateForm({ gitlabProjectId })}
              disabled={isGithub}
              validationState={isDuplicate ? 'invalid' : undefined}
              errorMessage={isDuplicate ? 'Такой репозиторий уже отслеживается' : undefined}
            />
            <TextInput
              label="или GitHub репозиторий"
              placeholder="owner/name — задачи берутся из issues"
              value={form.githubRepo}
              onUpdate={(githubRepo) => updateForm({ githubRepo })}
              validationState={isGithubFormatInvalid ? 'invalid' : undefined}
              errorMessage={isGithubFormatInvalid ? 'Формат: owner/name' : undefined}
            />
            {isGithub && (
              <TextInput
                label="Метка GitHub issues"
                placeholder="loop"
                value={form.githubLabel}
                onUpdate={(githubLabel) => updateForm({ githubLabel })}
              />
            )}
            <TextInput
              label="Локальный путь"
              placeholder="/Users/you/Projects/my-repo"
              value={form.path}
              onUpdate={(path) => updateForm({ path })}
            />
            <TextInput
              label="Базовая ветка"
              placeholder="main"
              value={form.baseBranch}
              onUpdate={(baseBranch) => updateForm({ baseBranch })}
            />
            <TextInput
              label="Include (через запятую)"
              placeholder="**/*.ts, **/*.tsx"
              value={form.include}
              onUpdate={(include) => updateForm({ include })}
            />
            <TextInput
              label="Exclude (через запятую)"
              placeholder="**/node_modules/**"
              value={form.exclude}
              onUpdate={(exclude) => updateForm({ exclude })}
            />
          </div>
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={closeDialog}
          onClickButtonApply={handleAdd}
          textButtonApply="Добавить"
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: !isValid || isAdding, loading: isAdding }}
        />
      </Dialog>

      <Dialog open={!!toRemove} onClose={() => setToRemove(null)}>
        <DialogHeader caption="Удалить репозиторий" />
        <DialogBody>
          Перестать отслеживать {toRemove?.gitlabProjectId}: {toRemove?.path}?
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setToRemove(null)}
          onClickButtonApply={handleRemove}
          textButtonApply="Удалить"
          textButtonCancel="Отмена"
          propsButtonApply={{ view: 'outlined-danger' }}
        />
      </Dialog>
    </>
  )
}

export default TrackedProjectsSection;
