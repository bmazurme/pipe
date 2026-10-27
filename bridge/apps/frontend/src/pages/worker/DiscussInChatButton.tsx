import { useState } from 'react';
import { Comment } from '@gravity-ui/icons';
import { Alert, Button, Icon } from '@gravity-ui/uikit';
import { useNavigate } from 'react-router-dom';

import { Dialog } from '../../shared/ui/Dialog';
import { getErrorMessage, useAttachRunResultMutation, useCreateChatMutation, WorkerJob } from '../../store/api';

const FINISHED = ['succeeded', 'failed', 'cancelled'];

interface DiscussInChatButtonProps {
  job: WorkerJob;
}

// Starts a new chat with this run's outcome already in its context and opens it. If the attach fails the chat
// stays (it is not deleted silently): the error is shown with a link to it.
export function DiscussInChatButton({ job }: DiscussInChatButtonProps) {
  const navigate = useNavigate();
  const [createChat, { isLoading: isCreating }] = useCreateChatMutation();
  const [attachRunResult, { isLoading: isAttaching }] = useAttachRunResultMutation();
  const [error, setError] = useState<string | null>(null);
  const [createdChatId, setCreatedChatId] = useState<number | null>(null);

  if (!FINISHED.includes(job.status)) return null;

  const openChat = (chatId: number) => navigate(`/chat?chat=${chatId}`);

  const handleClick = async () => {
    setError(null);
    setCreatedChatId(null);

    let chatId: number;

    try {
      chatId = (await createChat({ model: 'sonnet' }).unwrap()).id;
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось создать чат'));
      return;
    }

    try {
      await attachRunResult({ chatId, jobId: job.id }).unwrap();
    } catch (err) {
      setCreatedChatId(chatId);
      setError(getErrorMessage(err, 'Не удалось прикрепить результат'));
      return;
    }

    openChat(chatId);
  };

  const closeError = () => {
    setError(null);
    setCreatedChatId(null);
  };

  return (
    <>
      <Button view="outlined" loading={isCreating || isAttaching} onClick={() => void handleClick()}>
        <Icon data={Comment} size={16} />
        Обсудить в чате
      </Button>

      <Dialog open={error !== null} onClose={closeError} maxWidth="s" aria-labelledby={`discuss-job-${job.id}`}>
        <Dialog.Header caption={`Не удалось обсудить задачу #${job.id}`} id={`discuss-job-${job.id}`} />
        <Dialog.Body>{error && <Alert theme="danger" view="filled" message={error} />}</Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Закрыть"
          onClickButtonCancel={closeError}
          {...(createdChatId !== null && {
            textButtonApply: 'Открыть чат',
            onClickButtonApply: () => openChat(createdChatId),
          })}
        />
      </Dialog>
    </>
  );
}
