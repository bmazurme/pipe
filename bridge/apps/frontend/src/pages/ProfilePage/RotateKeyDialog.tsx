import { useEffect, useState } from 'react';
import { Alert, Text } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import { type ApiKey, describeApiError, useRotateApiKeyMutation } from '../../store/api';
import { describeScope } from './apiKeyDialogUtils';
import { KeyTokenView } from './KeyTokenView';

// «Перевыпустить»: the same key (name, scope, term) with a new secret. The old one stops working at once — the server checks it before it
// answers — so the person has to put the new one where the old one was used, and the dialog says so before it does anything.
export function RotateKeyDialog({ apiKey, onClose }: { apiKey: ApiKey | null; onClose: () => void }) {
  const [rotate, { isLoading }] = useRotateApiKeyMutation();
  const [created, setCreated] = useState<{ token: string; summary: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [warnUncopied, setWarnUncopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCreated(null);
    setCopied(false);
    setWarnUncopied(false);
    setError(null);
  }, [apiKey?.id]);

  const close = () => {
    setCreated(null);
    onClose();
  };

  // Closing with the new token not copied asks once more: it cannot be shown again, and the old one is already dead.
  const requestClose = () => {
    if (created && !copied && !warnUncopied) {
      setWarnUncopied(true);

      return;
    }

    close();
  };

  const handleRotate = async () => {
    if (!apiKey) return;

    setError(null);

    try {
      const result = await rotate(apiKey.id).unwrap();
      const until = result.expiresAt ? `до ${new Date(result.expiresAt).toLocaleDateString('ru-RU')}` : 'бессрочно';

      setCreated({ token: result.token, summary: [result.name, until, describeScope(result.scope)].join(' · ') });
    } catch (err) {
      setError(`Не удалось перевыпустить ключ: ${describeApiError(err)}. Старый ключ остался как был.`);
    }
  };

  return (
    <Dialog open={apiKey !== null} onClose={requestClose} maxWidth="s" aria-labelledby="rotate-api-key-title">
      {created ? (
        <>
          <Dialog.Header caption="Ключ перевыпущен" id="rotate-api-key-title" />
          <Dialog.Body>
            <KeyTokenView
              token={created.token}
              summary={created.summary}
              copied={copied}
              warnUncopied={warnUncopied}
              onCopied={() => setCopied(true)}
              note="Старый ключ проверен: он больше не работает."
            />
          </Dialog.Body>
          <Dialog.Footer
            textButtonApply={warnUncopied && !copied ? 'Закрыть без копирования' : 'Готово'}
            propsButtonApply={{ view: warnUncopied && !copied ? 'outlined-danger' : 'action' }}
            onClickButtonApply={requestClose}
          />
        </>
      ) : (
        <>
          <Dialog.Header caption={`Перевыпустить ключ «${apiKey?.name ?? ''}»?`} id="rotate-api-key-title" />
          <Dialog.Body>
            <Text color="secondary">
              Будет создан такой же ключ (название, область и срок те же) с новым секретом, а прежний перестанет работать сразу — bridge проверит это, прежде чем показать новый.
              Замените его там, где ключ используется (sync-cli, reports, скрипты): пока вы этого не сделаете, они получат 401.
            </Text>
            {error && <Alert theme="danger" view="filled" message={error} />}
          </Dialog.Body>
          <Dialog.Footer
            textButtonCancel="Отмена"
            textButtonApply="Перевыпустить"
            loading={isLoading}
            onClickButtonCancel={close}
            onClickButtonApply={() => void handleRotate()}
          />
        </>
      )}
    </Dialog>
  );
}
