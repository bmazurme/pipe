import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MagicWand } from '@gravity-ui/icons';
import { Alert, Button, Select, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import {
  getErrorMessage,
  useAskLabKnowledgeMutation,
  useGetLabKnowledgeStatusQuery,
  useListLabProjectsQuery,
  useReindexLabKnowledgeMutation,
  type LabKnowledgeMatch,
} from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import styles from './ImprovePage.module.css';

// Same reasoning as Lab's own ProjectsTab: the server turns a refusal into the bare message, not wrapped in
// something getErrorMessage would otherwise flatten into the generic fallback.
function errorReason(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error) return error;
  if (Array.isArray(error) && error.length > 0) return error.join('. ');

  return getErrorMessage(error, fallback);
}

// Ask a question over a Lab project's own markdown files (decisions, specs, READMEs) in seconds, without
// spinning up a full worker run. One project at a time — `?project=<id>` keeps the choice in the URL, the same
// way Chat keeps its active chat in `?chat=<id>`, so a link from Lab's Projects tab lands here pre-selected.
export function RagPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: projects, isLoading: isProjectsLoading } = useListLabProjectsQuery();

  const paramProjectId = Number(searchParams.get('project'));
  const projectId =
    projects?.find((project) => project.id === paramProjectId)?.id ?? projects?.[0]?.id ?? null;

  const { data: status, isFetching: isStatusLoading } = useGetLabKnowledgeStatusQuery(projectId ?? 0, {
    skip: projectId === null,
  });
  const [reindex, { isLoading: isReindexing }] = useReindexLabKnowledgeMutation();
  const [ask, { isLoading: isAsking }] = useAskLabKnowledgeMutation();
  const [question, setQuestion] = useState('');
  const [matches, setMatches] = useState<LabKnowledgeMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectProject = (id: number) => {
    setSearchParams({ project: String(id) }, { replace: true });
    setQuestion('');
    setMatches(null);
    setError(null);
  };

  const handleReindex = async () => {
    if (projectId === null) return;
    setError(null);

    try {
      await reindex(projectId).unwrap();
    } catch (err) {
      setError(errorReason(err, 'Не удалось переиндексировать'));
    }
  };

  const handleAsk = async () => {
    if (projectId === null || !question.trim()) return;
    setError(null);

    try {
      setMatches(await ask({ id: projectId, question: question.trim() }).unwrap());
    } catch (err) {
      setError(errorReason(err, 'Не удалось найти ответ'));
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="RAG"
        description="Поиск по markdown-файлам ваших проектов на вкладке Lab (решения, спецификации, README) — ответ собирается из самых подходящих фрагментов за секунды, без запуска worker."
      />

      {isProjectsLoading && <Skeleton style={{ height: 80 }} />}
      {!isProjectsLoading && (!projects || projects.length === 0) && (
        <EmptyState
          icon={MagicWand}
          title="Нечего искать"
          description="Подключите хотя бы один проект на вкладке Lab → Проекты, чтобы задавать вопросы по его документам."
        />
      )}

      {projects && projects.length > 0 && projectId !== null && (
        <div className={styles.panel}>
          <Select
            label="Проект"
            value={[String(projectId)]}
            onUpdate={([value]) => value && selectProject(Number(value))}
            options={projects.map((project) => ({ value: String(project.id), content: `${project.name} (${project.repo})` }))}
            width="max"
          />

          <div className={styles.toolbar}>
            <Text variant="body-2">
              {isStatusLoading
                ? 'Загрузка…'
                : status
                  ? `Проиндексировано: ${status.files} файлов, ${status.chunks} фрагментов`
                  : ''}
            </Text>
            <Button view="outlined" size="s" loading={isReindexing} onClick={() => void handleReindex()}>
              Переиндексировать
            </Button>
          </div>
          {status?.chunks === 0 && (
            <Text variant="caption-2" color="warning">
              Пока ничего не проиндексировано — нажмите «Переиндексировать».
            </Text>
          )}

          <TextInput
            label="Вопрос"
            value={question}
            onUpdate={setQuestion}
            controlProps={{
              onKeyDown: (event) => {
                if (event.key === 'Enter') void handleAsk();
              },
            }}
          />
          <Button view="action" size="s" loading={isAsking} disabled={!question.trim()} onClick={() => void handleAsk()}>
            Спросить
          </Button>
          {error && <Alert theme="danger" view="filled" message={error} />}
          {matches && matches.length === 0 && (
            <Text variant="caption-2" color="secondary">
              Ничего не найдено — попробуйте другие слова.
            </Text>
          )}
          {matches?.map((match, index) => (
            <div key={index} className={styles.row}>
              <div className={styles.rowMain}>
                <Text variant="caption-2" color="secondary">
                  {match.path}
                  {match.heading && ` · ${match.heading}`}
                </Text>
                <Text variant="body-2" style={{ whiteSpace: 'pre-wrap' }}>
                  {match.content}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
