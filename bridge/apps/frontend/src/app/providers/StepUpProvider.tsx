import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, TextInput } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import { useVerifyStepUpMutation } from '../../store/api';
import styles from './StepUpProvider.module.css';
import { setStepUpPrompt, storeStepUpGrant } from '../../store/step-up';

// The question the app asks before a dangerous action: a code from the authenticator app (or a recovery code). One
// dialog for the whole app — the store calls it through setStepUpPrompt when the backend answers STEP_UP_REQUIRED.
export function StepUpProvider() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verify, { isLoading }] = useVerifyStepUpMutation();
  const settle = useRef<((granted: boolean) => void) | null>(null);

  useEffect(() => {
    setStepUpPrompt(
      () =>
        new Promise<boolean>((resolve) => {
          settle.current = resolve;
          setCode('');
          setError(null);
          setOpen(true);
        }),
    );

    return () => setStepUpPrompt(null);
  }, []);

  const finish = useCallback((granted: boolean) => {
    setOpen(false);
    settle.current?.(granted);
    settle.current = null;
  }, []);

  const submit = async () => {
    const trimmed = code.trim();

    if (!trimmed) return;

    setError(null);

    try {
      const grant = await verify(trimmed).unwrap();

      storeStepUpGrant(grant.token, grant.expiresAt);
      finish(true);
    } catch (failure) {
      const data = (failure as { data?: { code?: string } })?.data;

      setError(
        data?.code === 'STEP_UP_LOCKED'
          ? 'Слишком много неверных кодов. Подождите несколько минут.'
          : data?.code === 'STEP_UP_INVALID_CODE'
            ? 'Код не подошёл. Каждый код действует один раз — подождите следующий.'
            : 'Не удалось проверить код. Попробуйте ещё раз.',
      );
    }
  };

  return (
    <Dialog open={open} onClose={() => finish(false)} maxWidth="s" aria-labelledby="step-up-title">
      <Dialog.Header caption="Подтвердите действие" id="step-up-title" />
      <Dialog.Body>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Text color="secondary">
            Введите 6-значный код из приложения-аутентификатора. Если телефона нет под рукой — один из кодов
            восстановления. Подтверждение действует 5 минут.
          </Text>
          <div className={styles.field}>
            <TextInput
              autoFocus
              size="l"
              value={code}
              onUpdate={setCode}
              placeholder="123456"
              controlProps={{ inputMode: 'text', autoComplete: 'one-time-code', 'aria-label': 'Код' }}
              validationState={error ? 'invalid' : undefined}
            />
          </div>
          {error && (
            <div className={styles.field}>
              <Alert theme="danger" view="filled" message={error} />
            </div>
          )}
          {/* A form needs its own submit so Enter works; the dialog's footer button does the same. */}
          <button type="submit" hidden />
        </form>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Подтвердить"
        loading={isLoading}
        propsButtonApply={{ disabled: !code.trim() }}
        onClickButtonCancel={() => finish(false)}
        onClickButtonApply={() => void submit()}
      />
    </Dialog>
  );
}
