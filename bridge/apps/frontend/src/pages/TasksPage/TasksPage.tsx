import { useState } from 'react';
import { Alert, Button, Loader, SegmentedRadioGroup, TextInput } from '@gravity-ui/uikit';

import {
  getErrorMessage,
  useCreateTaskCardMutation,
  useCreateTaskColumnMutation,
  useDeleteTaskColumnMutation,
  useGetTaskBoardQuery,
  useMoveTaskCardMutation,
  useRenameTaskColumnMutation,
  useUpdateTaskCardMutation,
} from '../../store/api';
import { PageHeader } from '../../widgets/PageHeader';
import { dropPosition } from './dropPosition';
import { TaskArchive } from './TaskArchive';
import { TaskColumnView } from './TaskColumnView';
import styles from './TasksPage.module.css';

type View = 'board' | 'archive';

export function TasksPage() {
  const [view, setView] = useState<View>('board');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [newColumn, setNewColumn] = useState('');
  const { data, isLoading, error } = useGetTaskBoardQuery();
  const [createColumn, createColumnState] = useCreateTaskColumnMutation();
  const [renameColumn, renameState] = useRenameTaskColumnMutation();
  const [deleteColumn, deleteState] = useDeleteTaskColumnMutation();
  const [createCard, createCardState] = useCreateTaskCardMutation();
  const [updateCard, updateState] = useUpdateTaskCardMutation();
  const [moveCard, moveState] = useMoveTaskCardMutation();
  const mutationError =
    createColumnState.error ??
    renameState.error ??
    deleteState.error ??
    createCardState.error ??
    updateState.error ??
    moveState.error;

  const addColumn = async () => {
    if (!newColumn.trim()) return;
    await createColumn({ title: newColumn.trim() });
    setNewColumn('');
  };

  const handleDrop = (columnId: number, beforeCardId: number | null) => {
    const dragged = draggedId;
    const column = data?.columns.find((c) => c.id === columnId);

    setDraggedId(null);
    if (dragged === null || !column) return;
    void moveCard({ id: dragged, columnId, position: dropPosition(column, dragged, beforeCardId) });
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Tasks" description="Колонки и карточки: перетаскивайте карточки между колонками, ненужные убирайте в архив." />
      <SegmentedRadioGroup value={view} onUpdate={(value) => setView(value as View)}>
        <SegmentedRadioGroup.Option value="board">Доска</SegmentedRadioGroup.Option>
        <SegmentedRadioGroup.Option value="archive">Архив</SegmentedRadioGroup.Option>
      </SegmentedRadioGroup>
      {mutationError && view === 'board' && <Alert theme="danger" message={getErrorMessage(mutationError, 'Не удалось выполнить действие')} />}
      {view === 'archive' ? (
        <TaskArchive />
      ) : isLoading ? (
        <div className={styles.centered}>
          <Loader />
        </div>
      ) : error ? (
        <Alert theme="danger" message={getErrorMessage(error, 'Не удалось выполнить действие')} />
      ) : (
        <div className={styles.board}>
          {data?.columns.map((column) => (
            <TaskColumnView
              key={column.id}
              column={column}
              draggedId={draggedId}
              onDragStart={setDraggedId}
              onDragEnd={() => setDraggedId(null)}
              onDrop={handleDrop}
              onAddCard={(columnId, title, description) => void createCard({ columnId, title, description })}
              onSaveCard={(id, title, description) => void updateCard({ id, title, description })}
              onArchiveCard={(id) => void updateCard({ id, archived: true })}
              onRename={(id, title) => void renameColumn({ id, title })}
              onDelete={(id) => void deleteColumn(id)}
            />
          ))}
          <div className={styles.addColumn}>
            <div className={styles.form}>
              <TextInput
                value={newColumn}
                onUpdate={setNewColumn}
                placeholder="Новая колонка"
                controlProps={{ 'aria-label': 'Название новой колонки' }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addColumn();
                }}
              />
              <Button view="action" onClick={() => void addColumn()} disabled={!newColumn.trim()}>
                Добавить колонку
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
