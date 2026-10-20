import { useState } from 'react';
import { Alert, Dialog, DialogBody, DialogFooter, DialogHeader, Select, Text, TextInput } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';
import type { MigrationProjectType } from '@reports/shared';

import style from '../subscription.module.css';

type Props = {
  open: boolean;
  migrations: MigrationProjectType[];
  loading: boolean;
  onClose: () => void;
  onStart: (payload: { migrationId: string; description: string; title?: string }) => void;
};

// A migration task: which module has to be brought up to date or added in the target repository, in the person's own words.
function MigrationDialog({ open, migrations, loading, onClose, onStart }: Props) {
  const [migrationId, setMigrationId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Falls back to the first migration, so the usual single-migration case needs no extra click.
  const effectiveId = migrationId ?? migrations[0]?.id;
  const chosen = migrations.find((item) => item.id === effectiveId);
  const canStart = Boolean(effectiveId && description.trim());

  const handleStart = () => {
    if (!effectiveId || !description.trim()) return;

    onStart({ migrationId: effectiveId, description: description.trim(), title: title.trim() || undefined });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader caption="Новая задача: миграция" />
      <DialogBody>
        {migrations.length === 0 ? (
          <Alert
            theme="info"
            view="filled"
            title="Сначала добавьте миграцию"
            message={(
              <>
                Укажите два репозитория — текущий и тот, куда переезжает проект, — в <Link to="/settings">Settings → Подписка → Миграции</Link>.
              </>
            )}
          />
        ) : (
          <div className={style.publishForm}>
            {migrations.length > 1 && (
              <Select
                label="Миграция"
                value={effectiveId ? [effectiveId] : []}
                onUpdate={([value]) => setMigrationId(value)}
                options={migrations.map((item) => ({ value: item.id, content: item.name }))}
                width="max"
              />
            )}
            {chosen && (
              <Text variant="caption-2" color="secondary">
                Читается: {chosen.sourcePath}. Результат распакуется в: {chosen.targetPath}
                {chosen.targetBaseBranch ? ` (ветка задачи — от ${chosen.targetBaseBranch})` : ''}.
              </Text>
            )}
            <TextInput label="Название (необязательно)" placeholder="Модуль Orders" value={title} onUpdate={setTitle} />
            <textarea
              aria-label="Задача"
              className={style.templateBody}
              placeholder="Какой модуль нужно актуализировать или добавить в целевом репозитории — своими словами, с деталями"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <Text variant="caption-2" color="secondary">
              Дальше: «Подтвердить и отправить» уйдёт посылка с обоими репозиториями (после словаря подстановки), worker вернёт результат, и «Получить» распакует его в целевой репозиторий.
            </Text>
          </div>
        )}
      </DialogBody>
      <DialogFooter
        onClickButtonCancel={onClose}
        onClickButtonApply={handleStart}
        textButtonApply="Создать задачу"
        textButtonCancel="Отмена"
        propsButtonApply={{ disabled: !canStart || loading || migrations.length === 0, loading }}
      />
    </Dialog>
  );
}

export default MigrationDialog;
