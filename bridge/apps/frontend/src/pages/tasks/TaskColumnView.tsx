import { useEffect, useState } from 'react';
import { Button, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import type { TaskColumn } from '../../store/api';
import styles from '../TasksPage.module.css';
import { TaskCardView } from './TaskCardView';

interface Props {
  column: TaskColumn;
  draggedId: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDrop: (columnId: number, beforeCardId: number | null) => void;
  onAddCard: (columnId: number, title: string, description: string) => void;
  onSaveCard: (id: number, title: string, description: string) => void;
  onArchiveCard: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
}

export function TaskColumnView({
  column,
  draggedId,
  onDragStart,
  onDragEnd,
  onDrop,
  onAddCard,
  onSaveCard,
  onArchiveCard,
  onRename,
  onDelete,
}: Props) {
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // The drop highlight must not outlive the drag: a card dropped elsewhere or a drag cancelled with Escape never reaches this column's
  // onDrop / onDragLeave.
  useEffect(() => {
    if (draggedId === null) setOver(false);
  }, [draggedId]);

  const add = () => {
    if (!title.trim()) return;
    onAddCard(column.id, title.trim(), description);
    setTitle('');
    setDescription('');
    setAdding(false);
  };

  const rename = () => {
    const next = window.prompt('Название колонки', column.title)?.trim();

    if (next && next !== column.title) onRename(column.id, next);
  };

  return (
    <section
      className={`${styles.column} ${over ? styles.columnOver : ''}`}
      aria-label={`Колонка ${column.title}`}
      onDragOver={(event) => {
        if (draggedId === null) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        // dragleave also fires when the pointer moves from the column onto one of ITS OWN children (a card, the header, a button) —
        // that used to switch the highlight off, and the next dragover switched it back on: a flickering, broken border. Only a
        // pointer that is really outside the column ends it.
        const box = event.currentTarget.getBoundingClientRect();
        const inside = event.clientX > box.left && event.clientX < box.right && event.clientY > box.top && event.clientY < box.bottom;

        if (!inside) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDrop(column.id, null);
      }}
    >
      <div className={styles.columnHeader}>
        <Text variant="subheader-2">{column.title}</Text>
        <div className={styles.actions}>
          <Button size="xs" view="flat" onClick={rename} aria-label={`Переименовать колонку ${column.title}`}>
            ✎
          </Button>
          {column.cards.length === 0 && (
            <Button size="xs" view="flat" onClick={() => onDelete(column.id)} aria-label={`Удалить колонку ${column.title}`}>
              ✕
            </Button>
          )}
        </div>
      </div>
      <ul className={styles.cards}>
        {column.cards.map((card) => (
          <TaskCardView
            key={card.id}
            card={card}
            dragging={draggedId === card.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDropBefore={(beforeId) => {
              setOver(false);
              onDrop(column.id, beforeId);
            }}
            onSave={onSaveCard}
            onArchive={onArchiveCard}
          />
        ))}
      </ul>
      {adding ? (
        <div className={styles.form}>
          <TextInput value={title} onUpdate={setTitle} placeholder="Заголовок" controlProps={{ 'aria-label': 'Заголовок новой карточки' }} />
          <TextArea value={description} onUpdate={setDescription} placeholder="Описание" minRows={3} controlProps={{ 'aria-label': 'Описание новой карточки' }} />
          <div className={styles.actions}>
            <Button view="action" size="s" onClick={add} disabled={!title.trim()}>
              Добавить
            </Button>
            <Button size="s" onClick={() => setAdding(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button view="flat" size="s" onClick={() => setAdding(true)}>
          + Добавить карточку
        </Button>
      )}
    </section>
  );
}
