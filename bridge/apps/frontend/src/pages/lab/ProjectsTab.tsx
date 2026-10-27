import { useState } from 'react';
import { ArrowUpRightFromSquare, Pencil, Plus, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Icon, Label, Skeleton, Text, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';
import { LogoGithub } from '@gravity-ui/icons';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  LabProject,
  useCheckLabProjectMutation,
  useCreateLabProjectMutation,
  useDeleteLabProjectMutation,
  useListLabProjectsQuery,
  useUpdateLabProjectMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import styles from '../ImprovePage.module.css';
import { describeTokenExpiry } from './tokenExpiry';

const EMPTY = { name: '', repo: '', token: '', baseBranch: 'main' };

// GitHub tokens are far longer than this; it only catches an accidental fragment. Matches the backend's minimum.
const MIN_TOKEN_LENGTH = 10;

// The lab API turns a server refusal into the bare message (a string, or a list of them for field validation), which getErrorMessage
// deliberately does not unwrap — it would show the generic fallback and hide why a token or branch was refused.
function errorReason(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error) return error;
  if (Array.isArray(error) && error.length > 0) return error.join('. ');

  return getErrorMessage(error, fallback);
}

// The edit dialog works on a copy of the project; the token field starts empty because the stored token never comes back.
interface EditForm {
  project: LabProject;
  name: string;
  baseBranch: string;
  token: string;
}

// Only what the owner actually changed is sent: an empty token field keeps the stored token, and an untouched branch is not re-verified.
function buildPatch(form: EditForm): { name?: string; baseBranch?: string; token?: string } {
  const patch: { name?: string; baseBranch?: string; token?: string } = {};
  const name = form.name.trim();
  const baseBranch = form.baseBranch.trim();
  const token = form.token.trim();

  if (name && name !== form.project.name) patch.name = name;
  if (baseBranch && baseBranch !== form.project.baseBranch) patch.baseBranch = baseBranch;
  if (token) patch.token = token;

  return patch;
}

export function ProjectsTab() {
  const { data: projects, isLoading, isError } = useListLabProjectsQuery();
  const [create, { isLoading: isCreating }] = useCreateLabProjectMutation();
  const [check, { isLoading: isChecking, originalArgs: checkingId }] = useCheckLabProjectMutation();
  const [remove] = useDeleteLabProjectMutation();
  const [updateProject, { isLoading: isUpdating }] = useUpdateLabProjectMutation();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
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
      setError(errorReason(err, 'Не удалось подключить проект'));
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
      setError(errorReason(err, 'Не удалось проверить проект'));
    }
  };

  const startEdit = (project: LabProject) => {
    setNotice(null);
    setError(null);
    setEditError(null);
    setEdit({ project, name: project.name, baseBranch: project.baseBranch, token: '' });
  };

  const closeEdit = () => {
    setEdit(null);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!edit) return;

    if (!edit.name.trim() || !edit.baseBranch.trim()) {
      setEditError('Название и ветка не могут быть пустыми');

      return;
    }

    if (edit.token.trim() && edit.token.trim().length < MIN_TOKEN_LENGTH) {
      setEditError('Токен GitHub слишком короткий. Чтобы не менять токен, оставьте поле пустым');

      return;
    }

    const patch = buildPatch(edit);

    if (Object.keys(patch).length === 0) {
      closeEdit();

      return;
    }

    try {
      // A new token or branch is verified against the repository before anything is stored; a refusal leaves the old values in place.
      const project = await updateProject({ id: edit.project.id, ...patch }).unwrap();
      const access = project.canWrite ? 'чтение и запись работают' : 'токен читает, но не может писать — запуски не стартуют';

      if (patch.token) setNotice(`Токен проекта «${project.name}» обновлён: ${access}`);
      else if (patch.baseBranch) setNotice(`Ветка проекта «${project.name}» изменена на ${project.baseBranch}: ${access}`);
      else setNotice(`Проект «${project.name}» сохранён`);

      closeEdit();
    } catch (err) {
      setEditError(errorReason(err, 'Не удалось сохранить проект'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;

    const { id } = confirmDelete;

    setConfirmDelete(null);

    try {
      await remove(id).unwrap();
    } catch (err) {
      setError(errorReason(err, 'Не удалось отключить проект'));
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

      {projects?.map((project) => {
        const expiry = describeTokenExpiry(project.tokenExpiresAt);

        return (
        <div key={project.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Text variant="body-2">{project.name}</Text>
            <Text variant="caption-2" color="secondary">
              {project.repo} · ветка {project.baseBranch} · токен …{project.tokenHint}
              {expiry && ` · ${expiry.text}`}
              {project.checkedAt && ` · проверен ${formatRelativeTime(project.checkedAt)}`}
            </Text>
          </div>
          <div className={styles.rowActions}>
            {expiry?.label && <Label theme={expiry.label.theme}>{expiry.label.text}</Label>}
            <Label theme={project.canWrite ? 'success' : 'danger'}>{project.canWrite ? 'чтение и запись' : 'нет записи'}</Label>
            <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer noopener" aria-label={`Открыть ${project.repo} на GitHub`}>
              <Icon data={ArrowUpRightFromSquare} size={16} />
            </a>
            <Button view="outlined" size="s" loading={isChecking && checkingId === project.id} onClick={() => void handleCheck(project)}>
              Проверить
            </Button>
            <Button view="flat" size="s" aria-label={`Изменить: ${project.name}`} title="Изменить проект или обновить токен" onClick={() => startEdit(project)}>
              <Icon data={Pencil} size={16} />
            </Button>
            <Button view="flat-danger" size="s" aria-label={`Отключить: ${project.name}`} onClick={() => setConfirmDelete(project)}>
              <Icon data={TrashBin} size={16} />
            </Button>
          </div>
        </div>
        );
      })}

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

      <Dialog open={edit !== null} onClose={closeEdit} maxWidth="s" aria-labelledby="lab-project-edit-title">
        <Dialog.Header caption="Изменить проект" id="lab-project-edit-title" />
        <Dialog.Body>
          {edit && (
            <div className={styles.form}>
              <TextInput label="Название" value={edit.name} onUpdate={(name) => setEdit({ ...edit, name })} />
              <TextInput label="Репозиторий" value={edit.project.repo} disabled />
              <Text variant="caption-2" color="secondary">
                Репозиторий изменить нельзя: к нему привязаны расписания и история запусков. Чтобы сменить репозиторий, отключите проект и подключите заново.
              </Text>
              <TextInput label="Ветка" value={edit.baseBranch} onUpdate={(baseBranch) => setEdit({ ...edit, baseBranch })} />
              <TextInput
                label="Новый токен GitHub"
                type="password"
                placeholder="оставьте пустым, чтобы не менять"
                value={edit.token}
                onUpdate={(token) => setEdit({ ...edit, token })}
                controlProps={{ autoComplete: 'off' }}
              />
              <Text variant="caption-2" color="secondary">
                Сейчас сохранён токен …{edit.project.tokenHint}. Новый токен и ветка сначала проверяются на репозитории: если проверка не пройдена, прежние значения остаются.
              </Text>
              {editError && <Alert theme="danger" view="filled" message={editError} />}
            </div>
          )}
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Сохранить"
          propsButtonApply={{ loading: isUpdating, disabled: !edit || Object.keys(buildPatch(edit)).length === 0 }}
          onClickButtonCancel={closeEdit}
          onClickButtonApply={() => void handleSaveEdit()}
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
