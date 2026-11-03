import { useMemo, useState } from 'react';
import {
  ArrowRightArrowLeft,
  Calendar,
  Clock,
  Gift,
  Plus,
  TrashBin,
} from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  Icon,
  Label,
  Loader,
  SegmentedRadioGroup,
  Text,
} from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';
import { RangeDatePicker, type RangeValue } from '@gravity-ui/date-components';
import { dateTime, type DateTime } from '@gravity-ui/date-utils';

import {
  DayOff,
  DayOffType,
  useCreateDayOffMutation,
  useDeleteDayOffMutation,
  useListDayOffsQuery,
} from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { timeYearSelector } from '../../store/slices';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../TimePage.module.css';
import {
  countWeekends,
  groupConsecutiveDayOffs,
  isWeekend,
  listDates,
  MAX_RANGE_DAYS,
  weekdayShort,
} from './dayOffUtils';
import { YearSwitcher } from './YearSwitcher';

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
    /** What the day does to the calendar and the month's hours norm — shown under the picker in the add dialog. */
    description: string;
  }
> = {
  off: {
    optionLabel: 'Отгул',
    badgeLabel: 'День отдыха',
    badgeTheme: 'utility',
    icon: Calendar,
    removalHint: 'снова станет обычным рабочим или выходным днём по календарю.',
    description:
      'Отпуск, отгул или больничный. День не считается рабочим, норма часов за месяц уменьшается на 8 ч.',
  },
  holiday: {
    optionLabel: 'Праздник',
    badgeLabel: 'Праздник',
    badgeTheme: 'danger',
    icon: Gift,
    removalHint: 'снова станет рабочим днём.',
    description:
      'Государственный праздник. День не считается рабочим, норма часов за месяц уменьшается на 8 ч.',
  },
  short: {
    optionLabel: 'Короткий день',
    badgeLabel: 'Короткий день',
    badgeTheme: 'warning',
    icon: Clock,
    removalHint: 'снова станет днём обычной продолжительности.',
    description: 'Предпраздничный день на час короче: норма часов за месяц уменьшается на 1 ч.',
  },
  compensatory: {
    optionLabel: 'Рабочий выходной',
    badgeLabel: 'Рабочий выходной',
    badgeTheme: 'info',
    icon: ArrowRightArrowLeft,
    removalHint: 'снова станет обычным выходным днём.',
    description:
      'Суббота или воскресенье, которые по переносу стали рабочими: день считается рабочим, норма — 8 ч.',
  },
};

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';

  return 'дней';
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function DayOffsTab() {
  const year = useAppSelector(timeYearSelector);
  const { data: dayOffs = [], isLoading, isError, refetch } = useListDayOffsQuery(year);
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
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dayOffToRemove, setDayOffToRemove] = useState<DayOff | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const openDialog = () => {
    setSelectedType('off');
    setSelectedRange(null);
    setDialogError(null);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    if (!isSaving) setIsDialogOpen(false);
  };

  // The days the current range would add, so the dialog can say how many before the owner presses "Добавить".
  const rangeDates = useMemo(
    () =>
      selectedRange?.start && selectedRange?.end
        ? listDates(
            selectedRange.start.format('YYYY-MM-DD'),
            selectedRange.end.format('YYYY-MM-DD'),
          )
        : [],
    [selectedRange],
  );
  const rangeTooLong = rangeDates.length > MAX_RANGE_DAYS;
  const rangeWeekends = countWeekends(rangeDates);

  const handleAdd = async () => {
    if (rangeDates.length === 0 || rangeTooLong) return;

    setIsSaving(true);
    setDialogError(null);

    let added = 0;
    let skipped = 0;

    // Sequential: the backend rejects a date that already exists, so
    // concurrent creates could race on the same duplicate check.
    for (const date of rangeDates) {
      try {
        await createDayOff({ date, type: selectedType }).unwrap();
        added += 1;
      } catch {
        skipped += 1;
      }
    }

    setIsSaving(false);

    // Nothing went in: stay in the dialog so the range and the type are not lost.
    if (added === 0) {
      setDialogError(
        rangeDates.length === 1
          ? 'Этот день уже отмечен — выберите другой или удалите его в списке.'
          : 'Все выбранные дни уже отмечены — выберите другие даты.',
      );

      return;
    }

    setNotice(
      skipped > 0
        ? `Добавлено дней: ${added}. Пропущено: ${skipped} — они уже были отмечены.`
        : null,
    );
    setIsDialogOpen(false);
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
      <YearSwitcher />

      <Card view="outlined" className={styles.card}>
        <SectionHeader
          title="Дни отдыха"
          meta={dayOffs.length > 0 ? String(dayOffs.length) : undefined}
          actions={
            <Button
              view="action"
              size="m"
              onClick={openDialog}
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

        {notice && (
          <Alert theme="info" view="filled" message={notice} onClose={() => setNotice(null)} />
        )}

        {isError && !isLoading && (
          <Alert
            theme="danger"
            view="filled"
            message="Не удалось загрузить дни отдыха"
            actions={
              <Button view="outlined" size="s" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        )}

        {isLoading && (
          <div className={styles.centered}>
            <Loader size="m" />
          </div>
        )}

        {!isLoading && !isError && dayOffs.length === 0 && (
          <EmptyState
            icon={Calendar}
            title={`За ${year} год отгулов нет`}
            description="Добавьте отпуск, отгул, больничный, праздник, короткий день или рабочий выходной — рабочий календарь обновится автоматически."
          />
        )}

        {!isLoading && !isError && dayOffs.length > 0 && (
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
                      <Text
                        color={isWeekend(dayOff.date) ? 'danger' : 'secondary'}
                        className={styles.dayOffWeekday}
                        aria-label={`День недели: ${weekdayShort(dayOff.date)}`}
                      >
                        {weekdayShort(dayOff.date)}
                      </Text>
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

      <Dialog open={isDialogOpen} onClose={closeDialog} aria-labelledby="add-day-offs-title">
        <Dialog.Header caption="Добавить дни отдыха" id="add-day-offs-title" />
        <Dialog.Body>
          <div className={styles.form}>
            <div className={styles.formField}>
              <Text variant="subheader-1">Что отметить</Text>
              <SegmentedRadioGroup
                value={selectedType}
                onUpdate={(value) => setSelectedType(value as DayOffType)}
                width="max"
                disabled={isSaving}
              >
                {DAY_OFF_TYPES.map((type) => (
                  <SegmentedRadioGroup.Option key={type} value={type}>
                    {TYPE_META[type].optionLabel}
                  </SegmentedRadioGroup.Option>
                ))}
              </SegmentedRadioGroup>
              <Text color="secondary" variant="body-short">
                {TYPE_META[selectedType].description}
              </Text>
            </div>

            <div className={styles.formField}>
              <Text variant="subheader-1">Даты</Text>
              <RangeDatePicker
                className={styles.rangePicker}
                value={selectedRange}
                onUpdate={setSelectedRange}
                placeholderValue={dateTime({ input: `${year}-01-01` })}
                disabled={isSaving}
                autoFocus
                aria-label="Даты"
              />
              <Text color="secondary" variant="body-short">
                {rangeDates.length === 0
                  ? 'Для одного дня выберите одну и ту же дату в начале и в конце.'
                  : `Будет отмечено: ${rangeDates.length} ${pluralDays(rangeDates.length)}${
                      rangeWeekends > 0 && selectedType !== 'compensatory'
                        ? `, из них выходных по календарю — ${rangeWeekends}`
                        : ''
                    }.`}
              </Text>
              {rangeTooLong && (
                <Text color="danger" variant="body-short">
                  Слишком длинный период: не больше {MAX_RANGE_DAYS} дн. за раз. Проверьте год.
                </Text>
              )}
            </div>

            {dialogError && (
              <Alert
                theme="danger"
                view="filled"
                message={dialogError}
                onClose={() => setDialogError(null)}
              />
            )}
          </div>
        </Dialog.Body>
        <Dialog.Footer
          loading={isSaving}
          textButtonApply={
            rangeDates.length > 1 && !rangeTooLong ? `Добавить (${rangeDates.length})` : 'Добавить'
          }
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: rangeDates.length === 0 || rangeTooLong }}
          propsButtonCancel={{ disabled: isSaving }}
          onClickButtonCancel={closeDialog}
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
