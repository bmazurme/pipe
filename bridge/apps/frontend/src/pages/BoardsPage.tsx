import { useEffect, useState } from 'react';
import { Alert, Button, Card, Label, Skeleton, Text } from '@gravity-ui/uikit';
import { Server } from '@gravity-ui/icons';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import { type Board, type BoardScript, getErrorMessage, useCancelBoardUpdateMutation, useListBoardsQuery, useRequestBoardUpdateMutation } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import styles from './BoardsPage.module.css';

const FAST_POLL_MS = 10_000;
const SLOW_POLL_MS = 60_000;

const SCRIPT_THEME: Record<BoardScript['status'], 'success' | 'warning' | 'danger'> = {
  current: 'success',
  outdated: 'warning',
  missing: 'danger',
};

const SCRIPT_LABEL: Record<BoardScript['status'], string> = {
  current: 'актуален',
  outdated: 'устарел',
  missing: 'нет на плате',
};

const UPDATE_LABEL: Record<string, string> = {
  applied: 'применено',
  failed: 'ошибка',
};

function BoardCard({ board, onUpdate, onCancel, busy }: { board: Board; onUpdate: (host: string) => void; onCancel: (host: string) => void; busy: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const shown = board.scripts.filter((script) => showAll || script.status !== 'current');
  const manualOnly = board.outdated > 0 && board.updatable === 0;

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <Text variant="subheader-2">{board.host}</Text>
          <Text variant="caption-2" color="secondary">
            отчёт {formatRelativeTime(board.reportedAt)} · main {board.mainSha.slice(0, 7)}
            {board.agentVersion ? ` · агент ${board.agentVersion}` : ''}
          </Text>
        </div>
        <Label theme={board.online ? 'success' : 'danger'}>{board.online ? 'на связи' : 'не отвечает'}</Label>
        <Label theme={board.outdated === 0 ? 'success' : 'warning'}>{board.outdated === 0 ? 'скрипты актуальны' : `устарело: ${board.outdated}`}</Label>
        {board.pending ? (
          <>
            <Label theme="info">ждёт плату: {board.pending.sha.slice(0, 7)}</Label>
            <Button view="flat" size="s" disabled={busy} onClick={() => onCancel(board.host)}>
              Отменить
            </Button>
          </>
        ) : (
          <Button view="action" size="m" disabled={board.updatable === 0 || busy || !board.online} loading={busy} onClick={() => onUpdate(board.host)}>
            Обновить{board.updatable > 0 ? ` (${board.updatable})` : ''}
          </Button>
        )}
      </div>

      {manualOnly && (
        <Text variant="caption-2" color="secondary">
          Устарело только то, что ставится вручную (scp + install.sh): установщик агента и его откат — их не обновляет ни кнопка, ни сам агент.
        </Text>
      )}
      {board.scripts.some((script) => script.repoPath === 'infra/boardagent/board-agent.sh' && script.status === 'outdated') && (
        <Text variant="caption-2" color="secondary">
          Агент обновит и себя: новая версия сначала проверяется самопроверкой, старая сохраняется, а если новая не запустится, плата сама вернёт старую.
        </Text>
      )}
      {!board.online && (
        <Text variant="caption-2" color="secondary">
          Плата давно не отчитывалась: кнопка выключена, пока она не выйдет на связь.
        </Text>
      )}

      {shown.length > 0 && (
        <ul className={styles.scripts}>
          {shown.map((script) => (
            <li key={script.repoPath} className={styles.script}>
              <Label theme={SCRIPT_THEME[script.status]} size="xs">
                {SCRIPT_LABEL[script.status]}
              </Label>
              <Text variant="caption-2" className={styles.path} title={script.installed}>
                {script.repoPath}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {board.scripts.some((script) => script.status === 'current') && (
        <div>
          <Button view="flat-secondary" size="s" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Скрыть актуальные' : `Показать все (${board.scripts.length})`}
          </Button>
        </div>
      )}

      {board.lastUpdate && (
        <Text variant="caption-2" color={board.lastUpdate.status === 'failed' ? 'danger' : 'secondary'}>
          Последнее обновление: {UPDATE_LABEL[board.lastUpdate.status] ?? board.lastUpdate.status}, {board.lastUpdate.sha.slice(0, 7)},{' '}
          {formatRelativeTime(board.lastUpdate.finishedAt ?? board.lastUpdate.createdAt)}
          {board.lastUpdate.result ? ` — ${board.lastUpdate.result}` : ''}
        </Text>
      )}
    </Card>
  );
}

// Which scripts each board has installed against `main`, and the button that lets a board bring them up to date: the same decision as
// the button in the Telegram message. The board's agent applies it within a couple of minutes.
export function BoardsPage() {
  const [pollingInterval, setPollingInterval] = useState(SLOW_POLL_MS);
  const { data: boards, isLoading, isError, error } = useListBoardsQuery(undefined, { pollingInterval, skipPollingIfUnfocused: true });
  const [request, { isLoading: isRequesting, originalArgs: requestingHost, error: requestError }] = useRequestBoardUpdateMutation();
  const [cancel, { isLoading: isCancelling, originalArgs: cancellingHost, error: cancelError }] = useCancelBoardUpdateMutation();
  const anyPending = Boolean(boards?.some((board) => board.pending));


  // Fast while a decision waits for its board, slow otherwise.
  useEffect(() => {
    setPollingInterval(anyPending ? FAST_POLL_MS : SLOW_POLL_MS);
  }, [anyPending]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Платы"
        description="Скрипты, установленные на платах, против main. Кнопка «Обновить» разрешает плате поставить именно этот коммит: она проверяет, что он влит в main, и отчитывается о результате."
      />

      {requestError && <Alert theme="danger" view="filled" message={typeof requestError === 'string' ? requestError : getErrorMessage(requestError, 'Не удалось разрешить обновление')} />}
      {cancelError && <Alert theme="danger" view="filled" message={typeof cancelError === 'string' ? cancelError : getErrorMessage(cancelError, 'Не удалось отменить обновление')} />}
      {isLoading && <Skeleton style={{ height: 120 }} />}
      {isError && <Alert theme="danger" view="filled" message={typeof error === 'string' ? error : getErrorMessage(error, 'Не удалось загрузить платы')} />}
      {boards && boards.length === 0 && (
        <EmptyState icon={Server} title="Плат пока нет" description="Плата появится здесь после первого отчёта своего агента (infra/boardagent: установка описана в README каталога)." />
      )}

      {boards?.map((board) => (
        <BoardCard key={board.host} board={board} busy={(isRequesting && requestingHost === board.host) || (isCancelling && cancellingHost === board.host)} onUpdate={(host) => void request(host)} onCancel={(host) => void cancel(host)} />
      ))}
    </div>
  );
}
