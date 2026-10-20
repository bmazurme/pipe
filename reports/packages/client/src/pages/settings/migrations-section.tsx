import { useState } from 'react';
import {
  Alert, Button, TextInput, Text, Icon, Dialog, DialogHeader, DialogBody, DialogFooter, useToaster,
} from '@gravity-ui/uikit';
import { Plus, TrashBin } from '@gravity-ui/icons';
import type { MigrationProjectType } from '@reports/shared';

import {
  useGetSubscriptionConfigQuery,
  useAddMigrationMutation,
  useRemoveMigrationMutation,
} from '../../store/api';
import { describeError } from '../../utils/describe-error';

import style from './settings.module.css';

const emptyForm = {
  name: '',
  sourcePath: '',
  sourceInclude: '',
  sourceExclude: '',
  targetPath: '',
  targetBaseBranch: '',
  targetInclude: '',
  targetExclude: '',
};

function splitList(value: string): string[] | undefined {
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);

  return items.length ? items : undefined;
}

// Projects that are moving to another repository (usually onto another stack): the current repository is only read, the target one
// receives what the worker makes. The task itself — which module to bring up to date or add — is written on the Subscription page.
function MigrationsSection() {
  const toaster = useToaster();
  const { data: config } = useGetSubscriptionConfigQuery();
  const [addMigration, { isLoading: isAdding }] = useAddMigrationMutation();
  const [removeMigration] = useRemoveMigrationMutation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [addError, setAddError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<MigrationProjectType | null>(null);

  const migrations = config?.migrations ?? [];
  const isDuplicate = migrations.some((item) => item.name.toLowerCase() === form.name.trim().toLowerCase());
  const isSamePath = Boolean(form.sourcePath.trim()) && form.sourcePath.trim() === form.targetPath.trim();
  const isValid = Boolean(form.name.trim() && form.sourcePath.trim() && form.targetPath.trim()) && !isDuplicate && !isSamePath;

  const updateForm = (patch: Partial<typeof emptyForm>) => {
    setAddError(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const closeDialog = () => {
    if (isAdding) return;

    setIsDialogOpen(false);
    setAddError(null);
  };

  const handleAdd = async () => {
    if (!isValid || isAdding) return;

    setAddError(null);

    try {
      await addMigration({
        name: form.name.trim(),
        sourcePath: form.sourcePath.trim(),
        sourceInclude: splitList(form.sourceInclude),
        sourceExclude: splitList(form.sourceExclude),
        targetPath: form.targetPath.trim(),
        targetBaseBranch: form.targetBaseBranch.trim() || undefined,
        targetInclude: splitList(form.targetInclude),
        targetExclude: splitList(form.targetExclude),
      }).unwrap();
      setIsDialogOpen(false);
      setForm(emptyForm);
    } catch (error) {
      // The server checks the folders (they exist, differ, the target is a git repository) and says what is wrong.
      setAddError(describeError(error));
    }
  };

  const handleRemove = async () => {
    const migration = toRemove;

    setToRemove(null);

    if (!migration) return;

    try {
      await removeMigration({ id: migration.id }).unwrap();
    } catch (error) {
      toaster.add({
        name: 'migration-remove-error',
        theme: 'danger',
        title: 'Не удалось удалить миграцию',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  return (
    <>
      <section className={style.codes}>
        <div className={style.sectionHead}>
          <Text variant="subheader-2">Миграции</Text>
          <Text variant="caption-2" color="secondary">
            Два репозитория: текущий (только читается) и тот, куда переезжает проект (в него распаковывается результат) — для задач «Миграция» в модуле Subscription
          </Text>
        </div>
        {migrations.length === 0 ? (
          <Text variant="body-2" color="secondary" className={style.codesEmpty}>
            Миграции ещё не добавлены
          </Text>
        ) : (
          <ul className={style.codesList}>
            {migrations.map((migration) => (
              <li key={migration.id} className={style.codesItem}>
                <span className={style.codesCode}>{migration.name}</span>
                <span className={style.codesLabel}>
                  {migration.sourcePath} → {migration.targetPath}{migration.targetBaseBranch ? ` · ${migration.targetBaseBranch}` : ''}
                </span>
                <Button
                  view="flat"
                  size="s"
                  onClick={() => setToRemove(migration)}
                  aria-label={`Удалить миграцию ${migration.name}`}
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
          Добавить миграцию
        </Button>
      </section>

      <Dialog open={isDialogOpen} onClose={closeDialog}>
        <DialogHeader caption="Добавить миграцию" />
        <DialogBody>
          {addError && <Alert theme="danger" title="Не удалось добавить миграцию" message={addError} className={style.codesAlert} />}
          <div className={style.codeForm}>
            <TextInput
              label="Название"
              placeholder="CRM → Nest.js"
              value={form.name}
              onUpdate={(name) => updateForm({ name })}
              validationState={isDuplicate ? 'invalid' : undefined}
              errorMessage={isDuplicate ? 'Миграция с таким названием уже есть' : undefined}
            />
            <Text variant="subheader-1">Текущий репозиторий (только читается)</Text>
            <TextInput
              label="Путь"
              placeholder="C:\projects\crm-old"
              value={form.sourcePath}
              onUpdate={(sourcePath) => updateForm({ sourcePath })}
            />
            <TextInput
              label="Include (через запятую)"
              placeholder="**/*.cs, **/*.csproj"
              value={form.sourceInclude}
              onUpdate={(sourceInclude) => updateForm({ sourceInclude })}
            />
            <TextInput
              label="Exclude (через запятую)"
              placeholder="**/bin/**, **/obj/**"
              value={form.sourceExclude}
              onUpdate={(sourceExclude) => updateForm({ sourceExclude })}
            />
            <Text variant="subheader-1">Целевой репозиторий (сюда распакуется результат)</Text>
            <TextInput
              label="Путь"
              placeholder="C:\projects\crm-new"
              value={form.targetPath}
              onUpdate={(targetPath) => updateForm({ targetPath })}
              validationState={isSamePath ? 'invalid' : undefined}
              errorMessage={isSamePath ? 'Это та же папка, что и текущий репозиторий' : undefined}
            />
            <TextInput
              label="Базовая ветка"
              placeholder="main"
              value={form.targetBaseBranch}
              onUpdate={(targetBaseBranch) => updateForm({ targetBaseBranch })}
            />
            <TextInput
              label="Include (через запятую)"
              placeholder="**/*.ts, **/*.json"
              value={form.targetInclude}
              onUpdate={(targetInclude) => updateForm({ targetInclude })}
            />
            <TextInput
              label="Exclude (через запятую)"
              placeholder="**/node_modules/**, **/dist/**"
              value={form.targetExclude}
              onUpdate={(targetExclude) => updateForm({ targetExclude })}
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
        <DialogHeader caption="Удалить миграцию" />
        <DialogBody>
          Удалить миграцию «{toRemove?.name}»? Репозитории на диске не изменятся; задачи этой миграции в списке останутся без неё.
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
  );
}

export default MigrationsSection;
