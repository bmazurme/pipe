import { useState } from 'react';
import { Alert, Text, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import { type CreatedFleetWorker, useCreateWorkerMutation } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { EnrollInstructions } from './EnrollInstructions';
import { ClaudeTokenField, DEFAULT_TOKEN, isVlessLink, VpnLinkField } from './WorkerAccessFields';

interface AddWorkerDialogProps {
  open: boolean;
  onClose: () => void;
  /** A worker that already exists and is being (re)connected: skip the name step. */
  existing?: CreatedFleetWorker;
}

// Two steps in one dialog: name it, then the code and what to run. Nothing secret is ever asked for.
export function AddWorkerDialog({ open, onClose, existing }: AddWorkerDialogProps) {
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedFleetWorker | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tokenId, setTokenId] = useState(DEFAULT_TOKEN);
  const [vpnLink, setVpnLink] = useState<string | null | undefined>(undefined);
  const [createWorker, { isLoading }] = useCreateWorkerMutation();
  const shown = created ?? existing;

  const handleClose = () => {
    setName('');
    setTokenId(DEFAULT_TOKEN);
    setVpnLink(undefined);
    setCreated(undefined);
    setError(null);
    onClose();
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setError(null);

    try {
      setCreated(
        await createWorker({
          name: name.trim(),
          ...(tokenId !== DEFAULT_TOKEN ? { claudeCredentialId: Number(tokenId) } : {}),
          ...(typeof vpnLink === 'string' ? { vpnLink } : {}),
        }).unwrap(),
      );
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Не удалось добавить worker');
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} size="m" aria-labelledby="add-worker-title">
      <Dialog.Header caption={shown ? `Подключение: ${shown.worker.name}` : 'Добавить worker'} id="add-worker-title" />
      <Dialog.Body>
        {shown ? (
          <EnrollInstructions
            workerId={shown.worker.id as number}
            workerName={shown.worker.name}
            code={shown.enrollCode}
            expiresAt={shown.enrollExpiresAt}
            onRenewed={setCreated}
          />
        ) : (
          <form
            className={styles.dialogForm}
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <Text color="secondary">
              После создания вы получите одну команду для ноды: она запускает worker и подключает его одноразовым кодом.
              Ни ключей, ни токенов в его переменных среды не нужно — токен, VPN и остальные настройки задаются здесь, в
              интерфейсе, и меняются позже в «Настройках».
            </Text>
            <label className={styles.dialogForm}>
              <Text variant="body-2" color="secondary">
                Название
              </Text>
              <TextInput value={name} onUpdate={setName} placeholder="Например, green или ноутбук" autoFocus hasClear />
            </label>
            <ClaudeTokenField value={tokenId} onChange={setTokenId} />
            <VpnLinkField currentHost={null} onChange={setVpnLink} />
            {error && <Alert theme="danger" view="filled" message={error} />}
          </form>
        )}
      </Dialog.Body>
      {shown ? (
        <Dialog.Footer textButtonApply="Готово" onClickButtonApply={handleClose} />
      ) : (
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Создать и получить код"
          loading={isLoading}
          propsButtonApply={{ disabled: !name.trim() || (typeof vpnLink === 'string' && !isVlessLink(vpnLink)) }}
          onClickButtonCancel={handleClose}
          onClickButtonApply={() => void handleCreate()}
        />
      )}
    </Dialog>
  );
}
