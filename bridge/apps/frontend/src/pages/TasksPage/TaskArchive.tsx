import { Archive } from '@gravity-ui/icons';
import { Alert, Button, Loader, Text } from '@gravity-ui/uikit';

import { getErrorMessage, useDeleteTaskCardMutation, useListArchivedTasksQuery, useUpdateTaskCardMutation } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import styles from './TasksPage.module.css';

export function TaskArchive() {
  const { data, isLoading, error } = useListArchivedTasksQuery();
  const [update, updateState] = useUpdateTaskCardMutation();
  const [remove, removeState] = useDeleteTaskCardMutation();
  const mutationError = updateState.error ?? removeState.error;

  if (isLoading) {
    return (
      <div className={styles.centered}>
        <Loader />
      </div>
    );
  }

  if (error) return <Alert theme="danger" message={getErrorMessage(error, 'Не удалось выполнить действие')} />;

  if (!data?.length) return <EmptyState icon={Archive} title="Архив пуст" description="Скрытые карточки появятся здесь." />;

  return (
    <>
      {mutationError && <Alert theme="danger" message={getErrorMessage(mutationError, 'Не удалось выполнить действие')} />}
      <ul className={styles.cards}>
        {data.map((card) => (
          <li key={card.id} className={styles.card}>
            <Text variant="subheader-1">{card.title}</Text>
            {card.description && (
              <Text variant="body-1" color="secondary" className={styles.description}>
                {card.description}
              </Text>
            )}
            <div className={styles.actions}>
              <Button size="xs" view="flat" onClick={() => void update({ id: card.id, archived: false })}>
                Вернуть на доску
              </Button>
              <Button size="xs" view="flat" onClick={() => void remove(card.id)}>
                Удалить
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
