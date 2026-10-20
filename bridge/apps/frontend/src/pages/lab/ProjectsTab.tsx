import { useState } from 'react';
import { ArrowUpRightFromSquare, Plus, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Dialog, Icon, Label, Skeleton, Text, TextInput } from '@gravity-ui/uikit';
import { LogoGithub } from '@gravity-ui/icons';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  LabProject,
  useCheckLabProjectMutation,
  useCreateLabProjectMutation,
  useDeleteLabProjectMutation,
  useListLabProjectsQuery,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import styles from '../ImprovePage.module.css';

const EMPTY = { name: '', repo: '', token: '', baseBranch: 'main' };

export function ProjectsTab() {
  const { data: projects, isLoading, isError } = useListLabProjectsQuery();
  const [create, { isLoading: isCreating }] = useCreateLabProjectMutation();
  const [check, { isLoading: isChecking, originalArgs: checkingId }] = useCheckLabProjectMutation();
  const [remove] = useDeleteLabProjectMutation();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LabProject | null>(null);

  const handleCreate = async () => {
    if (!form) return;
    if (!form.name.trim() || !/^[\w.-]+\/[\w.-]+$/.test(form.repo.trim()) || form.token.trim().length < 10) {
      setError('Укажите название, репозиторий в виде owner/name и токен GitHub');

      return;
    }

    try {
      const project = await create({ ...form, name: form.name.trim(), repo: form.repo.trim(), token: form.token.trim(), baseBranch: form.baseBranch.trim() || 'main' }).unwrap();

      setNotice(project.canWrite ? `Проект «${project.name}» подключён: чтение и запись работают` : `Проект «${project.name}» подключён, но токен не может писать — запуски не стартуют`);
      setForm(null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось подключить проект'));
    }
  };

  const handleCheck = async (project: LabProject) => {
    setNotice(null);
    setError(null);

    try {
      const result = await check(project.id).unwrap();

      if (result.problems.length) setError(`${project.name}: ${result.problems.join('. ')}`);
      else setNotice(`${project.name}: чтение и запись работают`);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось проверить проект'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;

    const { id } = confirmDelete;

    setConfirmDelete(null);

    try {
      await remove(id).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось отключить проект'));
    }
  };

  const update = (patch: Partial<typeof EMPTY>) => form && setForm({ ...form, ...patch });

  return (
    <div className={styles.panel}>
      <Text color="secondary" variant="body-2">
        Подключите свой репозиторий GitHub личным токеном: Lab читает его (снимок для worker) и пишет в него (ветка и pull request с результатом). Слияние остаётся за вами.
        Токену нужны права Contents и Pull requests — чтение и запись. Он хранится зашифрованным и обратно не показывается.
      </Text>
      <div className={styles.toolbar}>
        <Button view="action" size="m" onClick={() => { setError(null); setForm(EMPTY); }}>
          <Icon data={Plus} size={16} />
          Подключить проект
        </Button>
      </div>

      {notice && <Alert theme="success" view="filled" message={notice} />}
      {error && !form && <Alert theme="danger" view="filled" message={error} />}
      {isLoading && <Skeleton style={{ height: 80 }} />}
      {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить проекты" />}

      {projects && projects.length === 0 && <EmptyState icon={LogoGithub} title="Проектов нет" description="Подключите репозиторий GitHub, чтобы запускать в нём задачи и расписания." />}

      {projects?.map((project) => (
        <div key={project.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Text variant="body-2">{project.name}</Text>
            <Text variant="caption-2" color="secondary">
              {project.repo} · ветка {project.baseBranch} · токен …{project.tokenHint}
              {project.checkedAt && ` · проверен ${formatRelativeTime(project.checkedAt)}`}
            </Text>
          </div>
          <div className={styles.rowActions}>
            <Label theme={project.canWrite ? 'success' : 'danger'}>{project.canWrite ? 'чтение и запись' : 'нет записи'}</Label>
            <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer noopener" aria-label={`Открыть ${project.repo} на GitHub`}>
              <Icon data={ArrowUpRightFromSquare} size={16} />
            </a>
            <Button view="outlined" size="s" loading={isChecking && checkingId === project.id} onClick={() => void handleCheck(project)}>
              Проверить
            </Button>
            <Button view="flat-danger" size="s" aria-label={`Отключить: ${project.name}`} onClick={() => setConfirmDelete(project)}>
              <Icon data={TrashBin} size={16} />
            </Button>
          </div>
        </div>
      ))}

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} maxWidth="s" aria-labelledby="lab-project-delete-title">
        <Dialog.Header caption="Отключить проект" id="lab-project-delete-title" />
        <Dialog.Body>
          <Text variant="body-2">Отключить «{confirmDelete?.name}»? Его расписания будут удалены, история запусков останется.</Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Отключить"
          propsButtonApply={{ view: 'outlined-danger' }}
          onClickButtonCancel={() => setConfirmDelete(null)}
          onClickButtonApply={() => void handleDelete()}
        />
      </Dialog>

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="s" aria-labelledby="lab-project-title">
        <Dialog.Header caption="Подключить проект GitHub" id="lab-project-title" />
        <Dialog.Body>
          {form && (
            <div className={styles.form}>
              <TextInput label="Название" value={form.name} onUpdate={(name) => update({ name })} />
              <TextInput label="Репозиторий" placeholder="owner/name" value={form.repo} onUpdate={(repo) => update({ repo })} />
              <TextInput label="Ветка" value={form.baseBranch} onUpdate={(baseBranch) => update({ baseBranch })} />
              <TextInput label="Токен GitHub" type="password" value={form.token} onUpdate={(token) => update({ token })} controlProps={{ autoComplete: 'off' }} />
              {error && <Alert theme="danger" view="filled" message={error} />}
            </div>
          )}
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Подключить"
          propsButtonApply={{ loading: isCreating }}
          onClickButtonCancel={() => setForm(null)}
          onClickButtonApply={() => void handleCreate()}
        />
      </Dialog>
    </div>
  );
}
