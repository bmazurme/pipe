import { useState } from 'react';
import { Copy, ShieldCheck } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  ClipboardButton,
  Icon,
  Skeleton,
  Text,
  TextInput,
} from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import { SectionHeader } from '../../widgets/SectionHeader';
import {
  useDisableTwoFactorMutation,
  useEnableTwoFactorMutation,
  useGetTwoFactorStatusQuery,
  useRegenerateRecoveryCodesMutation,
  useSetupTwoFactorMutation,
  type TwoFactorSetup,
} from '../../store/api';
import styles from './ProfilePage.module.css';

function codeError(failure: unknown): string {
  const code = (failure as { data?: { code?: string } })?.data?.code;

  if (code === 'STEP_UP_LOCKED') return 'Слишком много неверных кодов. Подождите несколько минут.';
  if (code === 'STEP_UP_INVALID_CODE') return 'Код не подошёл. Каждый код действует один раз — подождите следующий.';

  return 'Не удалось выполнить. Попробуйте ещё раз.';
}

type CodeAction = 'disable' | 'regenerate';

// Second factor for dangerous actions (DEVELOPMENT-PLAN.md S6): a TOTP app plus ten recovery codes. The secret and
// the codes live in this component's state only while their dialog is open.
export function TwoFactorSection() {
  const { data: status, isLoading, isError } = useGetTwoFactorStatusQuery();
  const [setupTwoFactor, { isLoading: isStarting }] = useSetupTwoFactorMutation();
  const [enableTwoFactor, { isLoading: isEnabling }] = useEnableTwoFactorMutation();
  const [disableTwoFactor, { isLoading: isDisabling }] = useDisableTwoFactorMutation();
  const [regenerate, { isLoading: isRegenerating }] = useRegenerateRecoveryCodesMutation();

  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [firstCode, setFirstCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [codeAction, setCodeAction] = useState<CodeAction | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const enabled = status?.enabled === true;

  const startSetup = async () => {
    setError(null);

    try {
      setSetup(await setupTwoFactor().unwrap());
      setFirstCode('');
    } catch {
      setError('Не удалось начать настройку');
    }
  };

  const confirmSetup = async () => {
    setError(null);

    try {
      const result = await enableTwoFactor(firstCode.trim()).unwrap();

      setSetup(null);
      setRecoveryCodes(result.recoveryCodes);
    } catch (failure) {
      setError(codeError(failure));
    }
  };

  const confirmCodeAction = async () => {
    setError(null);

    try {
      if (codeAction === 'disable') {
        await disableTwoFactor(code.trim()).unwrap();
      } else {
        setRecoveryCodes((await regenerate(code.trim()).unwrap()).recoveryCodes);
      }

      setCodeAction(null);
      setCode('');
    } catch (failure) {
      setError(codeError(failure));
    }
  };

  const closeCodeAction = () => {
    setCodeAction(null);
    setCode('');
    setError(null);
  };

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.form}>
        <SectionHeader
          title="Двухфакторная защита"
          actions={
            enabled ? undefined : (
              <Button view="action" size="s" disabled={isLoading || isError} loading={isStarting} onClick={() => void startSetup()}>
                {status?.setupPending ? 'Продолжить настройку' : 'Включить'}
              </Button>
            )
          }
        />

        <Text color="secondary" variant="caption-2">
          Код из приложения-аутентификатора (Aegis, 2FAS, Google Authenticator) нужен для опасных действий: показать секрет,
          выдать или удалить ключ, запустить VPN-настройку, переключить подключение, удалить данные. Подтверждение действует
          5 минут. Если сессию кто-то украдёт, без телефона он ничего из этого не сделает.
        </Text>

        {isLoading && <Skeleton width="60%" height={16} />}

        {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить состояние защиты" />}

        {error && !setup && !codeAction && <Alert theme="danger" view="filled" message={error} />}

        {status && !enabled && (
          <Alert
            theme="warning"
            view="filled"
            message={
              status.enforced
                ? 'Защита выключена, а сервер требует её для опасных действий: пока вы её не включите, они недоступны.'
                : 'Защита выключена: опасные действия сейчас подтверждения не требуют.'
            }
          />
        )}

        {enabled && status && (
          <div className={styles.deviceRow}>
            <span className={styles.deviceIcon}>
              <Icon data={ShieldCheck} size={16} />
            </span>
            <div className={styles.deviceInfo}>
              <Text>Включена</Text>
              <Text color="secondary" variant="caption-2">
                кодов восстановления осталось: {status.recoveryCodesLeft}
                {status.recoveryCodesLeft <= 3 ? ' — пора выпустить новые' : ''}
              </Text>
            </div>
            <Button view="flat" onClick={() => setCodeAction('regenerate')}>
              Новые коды
            </Button>
            <Button view="flat-danger" onClick={() => setCodeAction('disable')}>
              Выключить
            </Button>
          </div>
        )}
      </div>

      <Dialog open={setup !== null} onClose={() => setSetup(null)} maxWidth="s" aria-labelledby="two-factor-setup-title">
        <Dialog.Header caption="Включить двухфакторную защиту" id="two-factor-setup-title" />
        <Dialog.Body>
          <div className={styles.dialogForm}>
            <Text color="secondary">
              В приложении-аутентификаторе добавьте аккаунт вручную: введите этот ключ (тип «по времени», 6 цифр, 30
              секунд). Затем впишите первый код из приложения.
            </Text>
            <div className={styles.endpointRow}>
              <Text variant="code-inline-2" ellipsis title="Ключ настройки">
                {setup?.secret}
              </Text>
              <ClipboardButton
                text={setup?.secret ?? ''}
                size="xs"
                view="flat-secondary"
                tooltipInitialText="Скопировать ключ"
                tooltipSuccessText="Скопировано"
              >
                <Icon data={Copy} size={14} />
              </ClipboardButton>
            </div>
            <div className={styles.endpointRow}>
              <Text color="secondary" variant="caption-2" ellipsis title="Ссылка otpauth">
                Ссылка для приложения (otpauth://)
              </Text>
              <ClipboardButton
                text={setup?.otpauthUri ?? ''}
                size="xs"
                view="flat-secondary"
                tooltipInitialText="Скопировать ссылку"
                tooltipSuccessText="Скопировано"
              >
                <Icon data={Copy} size={14} />
              </ClipboardButton>
            </div>
            <TextInput
              size="l"
              value={firstCode}
              onUpdate={setFirstCode}
              placeholder="Первый код из приложения"
              controlProps={{ inputMode: 'numeric', autoComplete: 'one-time-code', 'aria-label': 'Первый код' }}
            />
            {error && <Alert theme="danger" view="filled" message={error} />}
          </div>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Включить"
          loading={isEnabling}
          propsButtonApply={{ disabled: firstCode.trim().length < 6 }}
          onClickButtonCancel={() => setSetup(null)}
          onClickButtonApply={() => void confirmSetup()}
        />
      </Dialog>

      <Dialog
        open={recoveryCodes !== null}
        onClose={() => setRecoveryCodes(null)}
        maxWidth="s"
        aria-labelledby="two-factor-recovery-title"
      >
        <Dialog.Header caption="Коды восстановления" id="two-factor-recovery-title" />
        <Dialog.Body>
          <div className={styles.dialogForm}>
            <Text color="secondary">
              Сохраните их в менеджере паролей или на бумаге — сейчас они показаны в последний раз. Каждый код работает
              один раз и заменяет код из приложения, если телефон потерян.
            </Text>
            <div className={styles.tokenBox}>
              {recoveryCodes?.map((recoveryCode) => (
                <Text key={recoveryCode} variant="code-inline-2">
                  {recoveryCode}
                </Text>
              ))}
            </div>
            <ClipboardButton
              text={(recoveryCodes ?? []).join('\n')}
              size="s"
              view="outlined"
              tooltipInitialText="Скопировать все"
              tooltipSuccessText="Скопировано"
            >
              <Icon data={Copy} size={14} /> Скопировать все
            </ClipboardButton>
          </div>
        </Dialog.Body>
        <Dialog.Footer textButtonApply="Я сохранил(а)" onClickButtonApply={() => setRecoveryCodes(null)} />
      </Dialog>

      <Dialog open={codeAction !== null} onClose={closeCodeAction} maxWidth="s" aria-labelledby="two-factor-code-title">
        <Dialog.Header
          caption={codeAction === 'disable' ? 'Выключить защиту?' : 'Выпустить новые коды восстановления?'}
          id="two-factor-code-title"
        />
        <Dialog.Body>
          <div className={styles.dialogForm}>
            <Text color="secondary">
              {codeAction === 'disable'
                ? 'После этого опасные действия снова будут доступны без кода. Подтвердите кодом из приложения.'
                : 'Прежние коды перестанут работать. Подтвердите кодом из приложения.'}
            </Text>
            <TextInput
              autoFocus
              size="l"
              value={code}
              onUpdate={setCode}
              placeholder="Код"
              controlProps={{ autoComplete: 'one-time-code', 'aria-label': 'Код' }}
            />
            {error && <Alert theme="danger" view="filled" message={error} />}
          </div>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply={codeAction === 'disable' ? 'Выключить' : 'Выпустить'}
          loading={isDisabling || isRegenerating}
          propsButtonApply={{ disabled: !code.trim() }}
          onClickButtonCancel={closeCodeAction}
          onClickButtonApply={() => void confirmCodeAction()}
        />
      </Dialog>
    </Card>
  );
}
