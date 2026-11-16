import { Button, Icon, Spin, Text } from '@gravity-ui/uikit';
import { ArrowsRotateRight, CircleCheck, CircleMinus, CircleXmark, TriangleExclamation } from '@gravity-ui/icons';
import type { ConnectionCheckItemType } from '@reports/shared';

import type { CheckState } from './use-connection-checks';

import style from './settings.module.css';

const ICONS: Record<ConnectionCheckItemType['status'], { icon: typeof CircleCheck; className: string }> = {
  ok: { icon: CircleCheck, className: style.checkOk },
  warn: { icon: TriangleExclamation, className: style.checkWarn },
  error: { icon: CircleXmark, className: style.checkError },
  skip: { icon: CircleMinus, className: style.checkSkip },
};

type Props = {
  label: string;
  state: CheckState;
  onRun: () => void;
  // Set when a check makes no sense yet (nothing typed in); the button is disabled with this as its hint.
  disabledReason?: string;
};

function ConnectionCheckPanel({ label, state, onRun, disabledReason }: Props) {
  const { loading, result, error, stale } = state;
  const items = result && !stale ? result.items : [];

  return (
    <div className={style.check}>
      <div className={style.checkBar}>
        <Button
          view="outlined"
          size="m"
          loading={loading}
          disabled={Boolean(disabledReason)}
          onClick={onRun}
          title={disabledReason}
          aria-label={`Проверить соединение: ${label}`}
        >
          <Icon data={ArrowsRotateRight} size={16} />
          Проверить соединение
        </Button>
        <Text variant="caption-2" color="secondary" className={style.checkHint}>
          {disabledReason ?? 'Проверяются значения из формы — сохранять не нужно'}
        </Text>
      </div>

      <div role="status" aria-live="polite" className={style.checkResult}>
        {loading && (
          <Text variant="body-1" color="secondary" className={style.checkRow}>
            <Spin size="xs" /> Проверяю…
          </Text>
        )}

        {!loading && error && (
          <Text variant="body-1" className={`${style.checkRow} ${style.checkError}`}>
            <Icon data={CircleXmark} size={16} /> {error}
          </Text>
        )}

        {!loading && !error && stale && result && (
          <Text variant="caption-2" color="secondary">
            Значения изменились после проверки — проверьте ещё раз
          </Text>
        )}

        {!loading && items.map((entry) => {
          const { icon, className } = ICONS[entry.status];

          return (
            <div key={entry.label} className={style.checkItem}>
              <Icon data={icon} size={16} className={className} />
              <span className={style.checkLabel}>{entry.label}</span>
              <span className={style.checkMessage}>{entry.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ConnectionCheckPanel;
