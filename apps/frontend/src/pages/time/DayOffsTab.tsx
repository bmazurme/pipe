import { useMemo, useState } from 'react';
import {
  ArrowRightArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gift,
  Plus,
  TrashBin,
} from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  Dialog,
  Icon,
  Label,
  Loader,
  SegmentedRadioGroup,
  Text,
} from '@gravity-ui/uikit';
import { RangeDatePicker, type RangeValue } from '@gravity-ui/date-components';
import { DateTime } from '@gravity-ui/date-utils';

import {
  DayOff,
  DayOffType,
  useCreateDayOffMutation,
  useDeleteDayOffMutation,
  useListDayOffsQuery,
} from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { timeYearSelector, yearChanged } from '../../store/slices';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../TimePage.module.css';
import { groupConsecutiveDayOffs } from './dayOffUtils';

const PERIOD_COLOR_CLASSES = [styles.periodColorA, styles.periodColorB, styles.periodColorC];

const DAY_OFF_TYPES = ['off', 'holiday', 'short', 'compensatory'] as const;

const TYPE_META: Record<
  DayOffType,
  {
    optionLabel: string;
    badgeLabel: string;
    badgeTheme: 'utility' | 'danger' | 'warning' | 'info';
    icon: typeof Calendar;
    removalHint: string;
  }
> = {
  off: {
    optionLabel: 'Отгул',
    badgeLabel: 'День отдыха',
    badgeTheme: 'utility',
    icon: Calendar,
    removalHint: 'снова станет обычным рабочим или выходным днём по календарю.',
  },
  holiday: {
    optionLabel: 'Праздник',
    badgeLabel: 'Праздник',
    badgeTheme: 'danger',
    icon: Gift,
    removalHint: 'снова станет рабочим днём.',
  },
  short: {
    optionLabel: 'Короткий день',
    badgeLabel: 'Короткий день',
    badgeTheme: 'warning',
    icon: Clock,
    removalHint: 'снова станет днём обычной продолжительности.',
  },
  compensatory: {
    optionLabel: 'Рабочий выходной',
    badgeLabel: 'Рабочий выходной',
    badgeTheme: 'info',
    icon: ArrowRightArrowLeft,
    removalHint: 'снова станет обычным выходным днём.',
  },
};

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function DayOffsTab() {
  const dispatch = useAppDispatch();
  const year = useAppSelector(timeYearSelector);
  const { data: dayOffs = [], isLoading, isError } = useListDayOffsQuery(year);
  const [createDayOff] = useCreateDayOffMutation();
  const [deleteDayOff] = useDeleteDayOffMutation();

  // Runs of 2+ consecutive calendar days of the *same type* get a shared
  // tint so a vacation/sick-leave stretch (or a multi-day holiday) reads as
  // one block; a lone day stays untinted. Colors cycle across periods (not
  // within one) so two periods next to each other in the list stay visually
  // separated.
  const dayOffGroups = useMemo(() => groupConsecutiveDayOffs(dayOffs), [dayOffs]);

  const typeCounts = useMemo(() => {
    const counts: Record<DayOffType, number> = { off: 0, holiday: 0, short: 0, compensatory: 0 };
    for (const dayOff of dayOffs) counts[dayOff.type] += 1;
    return counts;
  }, [dayOffs]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<DayOffType>('off');
  const [selectedRange, setSelectedRange] = useState<RangeValue<DateTime> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dayOffToRemove, setDayOffToRemove] = useState<DayOff | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const handleAdd = async () => {
    if (!selectedRange?.start || !selectedRange?.end) return;

    setIsSaving(true);
    setError(null);

    const dates: string[] = [];
    let current = selectedRange.start.startOf('day');
    const end = selectedRange.end.startOf('day');

    while (!current.isAfter(end)) {
      dates.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }

    let added = 0;
    let skipped = 0;

    // Sequential: the backend rejects a date that already exists, so
    // concurrent creates could race on the same duplicate check.
    for (const date of dates) {
      try {
        await createDayOff({ date, type: selectedType }).unwrap();
        added += 1;
      } catch {
        skipped += 1;
      }
    }

    if (skipped > 0 && added === 0) {
      setError('Эти дни уже отмечены');
    }

    setIsSaving(false);
    setIsDialogOpen(false);
    setSelectedRange(null);
  };

  const handleRemove = async () => {
    if (!dayOffToRemove) return;

    setIsRemoving(true);
    setError(null);

    try {
      await deleteDayOff(dayOffToRemove.id).unwrap();
      setDayOffToRemove(null);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Не удалось удалить день');
    } finally {
      setIsRemoving(false);
    }
  };

  const hasSpecialDays =
    typeCounts.holiday > 0 || typeCounts.short > 0 || typeCounts.compensatory > 0;

  return (
    <div className={styles.tabPanel}>
      <div className={styles.yearSwitcher}>
        <Button view="flat" size="m" onClick={() => dispatch(yearChanged(year - 1))} aria-label="Предыдущий год">
          <Icon data={ChevronLeft} size={16} />
        </Button>
        <Text variant="subheader-1" className={styles.yearValue}>
          {year}
        </Text>
        <Button view="flat" size="m" onClick={() => dispatch(yearChanged(year + 1))} aria-label="Следующий год">
          <Icon data={ChevronRight} size={16} />
        </Button>
      </div>

      <Card view="outlined" className={styles.card}>
        <SectionHeader
          title="Дни отдыха"
          meta={dayOffs.length > 0 ? String(dayOffs.length) : undefined}
          actions={
            <Button
              view="action"
              size="m"
              onClick={() => {
                setSelectedType('off');
                setIsDialogOpen(true);
              }}
            >
              <Icon data={Plus} size={16} />
              Добавить
            </Button>
          }
        />

        {hasSpecialDays && (
          <div className={styles.typeSummary}>
            {DAY_OFF_TYPES.filter((type) => typeCounts[type] > 0)
              .map((type) => (
                <Label key={type} theme={TYPE_META[type].badgeTheme} icon={<Icon data={TYPE_META[type].icon} size={12} />}>
                  {TYPE_META[type].badgeLabel}: {typeCounts[type]}
                </Label>
              ))}
          </div>
        )}

        {error && (
          <Alert theme="danger" view="filled" message={error} onClose={() => setError(null)} />
        )}

        {isError && !isLoading && (
          <Alert theme="danger" view="filled" message="Не удалось загрузить дни отдыха" />
        )}

        {isLoading && (
          <div className={styles.centered}>
            <Loader size="m" />
          </div>
        )}

        {!isLoading && dayOffs.length === 0 && (
          <EmptyState
            icon={Calendar}
            title={`За ${year} год отгулов нет`}
            description="Добавьте отпуск, отгул, больничный, праздник, короткий день или рабочий выходной — рабочий календарь обновится автоматически."
          />
        )}

        {!isLoading && dayOffs.length > 0 && (
          <ul className={styles.dayOffList}>
            {dayOffGroups.map((group, groupIndex) => {
              const colorClass =
                group.length > 1
                  ? PERIOD_COLOR_CLASSES[groupIndex % PERIOD_COLOR_CLASSES.length]
                  : undefined;

              return group.map((dayOff) => {
                const meta = TYPE_META[dayOff.type];

                return (
                  <li
                    key={dayOff.id}
                    className={[styles.dayOffRow, colorClass].filter(Boolean).join(' ')}
                  >
                    <div className={styles.dayOffRowMain}>
                      <Icon data={meta.icon} size={16} className={styles.dayOffRowIcon} />
                      <Text>{formatDate(dayOff.date)}</Text>
                      {dayOff.type !== 'off' && (
                        <Label theme={meta.badgeTheme} size="xs">
                          {meta.badgeLabel}
                        </Label>
                      )}
                    </div>
                    <Button
                      view="flat-danger"
                      size="s"
                      aria-label={`Удалить ${formatDate(dayOff.date)}`}
                      onClick={() => setDayOffToRemove(dayOff)}
                    >
                      <Icon data={TrashBin} size={16} />
                    </Button>
                  </li>
                );
              });
            })}
          </ul>
        )}
      </Card>

      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <Dialog.Header caption="Добавить дни отдыха" />
        <Dialog.Body>
          <div className={styles.form}>
            <SegmentedRadioGroup
              value={selectedType}
              onUpdate={(value) => setSelectedType(value as DayOffType)}
              width="max"
            >
              {DAY_OFF_TYPES.map((type) => (
                <SegmentedRadioGroup.Option key={type} value={type}>
                  {TYPE_META[type].optionLabel}
                </SegmentedRadioGroup.Option>
              ))}
            </SegmentedRadioGroup>

            <RangeDatePicker
              className={styles.rangePicker}
              value={selectedRange}
              onUpdate={setSelectedRange}
            />
          </div>
        </Dialog.Body>
        <Dialog.Footer
          loading={isSaving}
          textButtonApply="Добавить"
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: !selectedRange?.start || !selectedRange?.end }}
          onClickButtonCancel={() => setIsDialogOpen(false)}
          onClickButtonApply={() => void handleAdd()}
        />
      </Dialog>

      <Dialog open={!!dayOffToRemove} onClose={() => setDayOffToRemove(null)}>
        <Dialog.Header caption="Удалить день отдыха?" />
        <Dialog.Body>
          {dayOffToRemove && (
            <Text color="secondary">
              {formatDate(dayOffToRemove.date)} {TYPE_META[dayOffToRemove.type].removalHint}
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer
          preset="danger"
          loading={isRemoving}
          textButtonApply="Удалить"
          textButtonCancel="Отмена"
          onClickButtonCancel={() => setDayOffToRemove(null)}
          onClickButtonApply={() => void handleRemove()}
        />
      </Dialog>
    </div>
  );
}
