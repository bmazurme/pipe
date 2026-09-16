import { useState } from 'react';
import {
  Button, TextInput, Text, Icon, Dialog, DialogHeader, DialogBody, DialogFooter, useToaster,
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

const emptyForm = { gitlabProjectId: '', path: '', baseBranch: '', include: '', exclude: '' };

function splitList(value: string): string[] | undefined {
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);

  return items.length ? items : undefined;
}

function TrackedProjectsSection() {
  const toaster = useToaster();
  const { data: config } = useGetSubscriptionConfigQuery();
  const [addTrackedProject] = useAddTrackedProjectMutation();
  const [removeTrackedProject] = useRemoveTrackedProjectMutation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [toRemove, setToRemove] = useState<TrackedProjectType | null>(null);

  const trackedProjects = config?.trackedProjects ?? [];
  const isDuplicate = Boolean(form.gitlabProjectId)
    && trackedProjects.some((project) => project.gitlabProjectId === form.gitlabProjectId);

  const handleAdd = async () => {
    if (!form.gitlabProjectId || !form.path || isDuplicate) {
      return;
    }

    const project: TrackedProjectType = {
      gitlabProjectId: form.gitlabProjectId,
      path: form.path,
      baseBranch: form.baseBranch || undefined,
      include: splitList(form.include),
      exclude: splitList(form.exclude),
    };

    setIsDialogOpen(false);
    setForm(emptyForm);

    try {
      await addTrackedProject(project).unwrap();
    } catch (error) {
      toaster.add({
        name: 'tracked-project-add-error',
        theme: 'danger',
        title: 'Не удалось добавить репозиторий',
        content: describeError(error),
        isClosable: true,
      });
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
                <span className={style.codesCode}>{project.gitlabProjectId}</span>
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

      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <DialogHeader caption="Добавить отслеживаемый репозиторий" />
        <DialogBody>
          <div className={style.codeForm}>
            <TextInput
              label="Код проекта GitLab"
              placeholder="ID проекта, как в «Коды проектов»"
              value={form.gitlabProjectId}
              onUpdate={(gitlabProjectId) => setForm((prev) => ({ ...prev, gitlabProjectId }))}
              validationState={isDuplicate ? 'invalid' : undefined}
              errorMessage={isDuplicate ? 'Такой репозиторий уже отслеживается' : undefined}
            />
            <TextInput
              label="Локальный путь"
              placeholder="/Users/you/Projects/my-repo"
              value={form.path}
              onUpdate={(path) => setForm((prev) => ({ ...prev, path }))}
            />
            <TextInput
              label="Базовая ветка"
              placeholder="main"
              value={form.baseBranch}
              onUpdate={(baseBranch) => setForm((prev) => ({ ...prev, baseBranch }))}
            />
            <TextInput
              label="Include (через запятую)"
              placeholder="**/*.ts, **/*.tsx"
              value={form.include}
              onUpdate={(include) => setForm((prev) => ({ ...prev, include }))}
            />
            <TextInput
              label="Exclude (через запятую)"
              placeholder="**/node_modules/**"
              value={form.exclude}
              onUpdate={(exclude) => setForm((prev) => ({ ...prev, exclude }))}
            />
          </div>
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setIsDialogOpen(false)}
          onClickButtonApply={handleAdd}
          textButtonApply="Добавить"
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: !form.gitlabProjectId || !form.path || isDuplicate }}
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
