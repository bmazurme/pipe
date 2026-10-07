import { useState } from 'react';
import { Dialog, DialogBody, DialogFooter, DialogHeader, Select, Text, TextInput } from '@gravity-ui/uikit';
import type { AnalysisKindType } from '@reports/shared';

import { KIND_OPTIONS } from '../analysis';

import { useGetAnalysisModulesQuery } from '../../../store/api';

import style from '../subscription.module.css';

export type AnalysisProject = { gitlabProjectId: string; githubRepo?: string };

type Props = {
  open: boolean;
  projects: AnalysisProject[];
  loading: boolean;
  onClose: () => void;
  onStart: (payload: { projectId: string; kind: AnalysisKindType; module?: string }) => void;
};

function AnalysisDialog({ open, projects, loading, onClose, onStart }: Props) {
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<AnalysisKindType>('general');
  const [module, setModule] = useState('');

  // Falls back to the first repository so the common single-repo case needs no extra click.
  const effectiveProjectId = projectId ?? projects[0]?.gitlabProjectId;
  const { data: modulesData } = useGetAnalysisModulesQuery(effectiveProjectId ?? '', { skip: !open || !effectiveProjectId });
  const listId = 'analysis-modules';

  const handleStart = () => {
    if (!effectiveProjectId) return;

    onStart({ projectId: effectiveProjectId, kind, module: module.trim() || undefined });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader caption="Запустить анализ" />
      <DialogBody>
        <div className={style.publishForm}>
          {projects.length > 1 && (
            <Select
              label="Репозиторий"
              value={effectiveProjectId ? [effectiveProjectId] : []}
              onUpdate={([value]) => {
                setProjectId(value);
                setModule('');
              }}
              options={projects.map((project) => ({ value: project.gitlabProjectId, content: project.githubRepo ?? project.gitlabProjectId }))}
              width="max"
            />
          )}
          <Select
            label="Тип анализа"
            value={[kind]}
            onUpdate={([value]) => setKind(value as AnalysisKindType)}
            options={KIND_OPTIONS}
            width="max"
          />
          <TextInput
            label="Модуль"
            placeholder="Весь репозиторий"
            value={module}
            onUpdate={setModule}
            hasClear
            controlProps={{ list: listId }}
            note="Папка внутри репозитория, например bridge/apps/frontend. Пусто — анализировать всё."
          />
          <datalist id={listId}>
            {(modulesData?.modules ?? []).map((name) => <option key={name} value={name} />)}
          </datalist>
          <Text variant="caption-2" color="secondary">
            Воркер предложит до 5 небольших улучшений; в GitHub issues они попадут только после вашего выбора.
          </Text>
        </div>
      </DialogBody>
      <DialogFooter
        onClickButtonCancel={onClose}
        onClickButtonApply={handleStart}
        textButtonApply="Запустить"
        textButtonCancel="Отмена"
        propsButtonApply={{ loading, disabled: !effectiveProjectId }}
      />
    </Dialog>
  );
}

export default AnalysisDialog;
