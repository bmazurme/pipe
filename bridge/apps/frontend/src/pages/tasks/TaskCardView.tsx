import { useState } from 'react';
import { Button, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import type { TaskCard } from '../../store/api';
import styles from '../TasksPage.module.css';

interface Props {
  card: TaskCard;
  dragging: boolean;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDropBefore: (id: number) => void;
  onSave: (id: number, title: string, description: string) => void;
  onArchive: (id: number) => void;
}

export function TaskCardView({ card, dragging, onDragStart, onDragEnd, onDropBefore, onSave, onArchive }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);

  const startEdit = () => {
    setTitle(card.title);
    setDescription(card.description);
    setEditing(true);
  };

  const save = () => {
    if (!title.trim()) return;
    onSave(card.id, title.trim(), description);
    setEditing(false);
  };

  return (
    <li
      className={`${styles.card} ${dragging ? styles.cardDragging : ''}`}
      data-testid={`task-card-${card.id}`}
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(card.id));
        onDragStart(card.id);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDropBefore(card.id);
      }}
    >
      {editing ? (
        <div className={styles.form}>
          <TextInput value={title} onUpdate={setTitle} placeholder="Заголовок" controlProps={{ 'aria-label': 'Заголовок карточки' }} />
          <TextArea value={description} onUpdate={setDescription} placeholder="Описание" minRows={3} controlProps={{ 'aria-label': 'Описание карточки' }} />
          <div className={styles.actions}>
            <Button view="action" size="s" onClick={save} disabled={!title.trim()}>
              Сохранить
            </Button>
            <Button size="s" onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Text variant="subheader-1">{card.title}</Text>
          {card.description && (
            <Text variant="body-1" color="secondary" className={styles.description}>
              {card.description}
            </Text>
          )}
          <div className={styles.actions}>
            <Button size="xs" view="flat" onClick={startEdit}>
              Изменить
            </Button>
            <Button size="xs" view="flat" onClick={() => onArchive(card.id)}>
              В архив
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
