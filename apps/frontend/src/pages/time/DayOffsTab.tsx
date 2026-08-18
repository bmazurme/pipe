import { useState } from 'react';
import { Calendar, Plus, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Dialog, Icon, Loader, Text } from '@gravity-ui/uikit';
import { RangeDatePicker, type RangeValue } from '@gravity-ui/date-components';
import { DateTime } from '@gravity-ui/date-utils';

import {
  DayOff,
  useCreateDayOffMutation,
  useDeleteDayOffMutation,
  useListDayOffsQuery,
} from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { timeDayOffsSelector, timeYearSelector } from '../../store/slices';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../TimePage.module.css';

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function DayOffsTab() {
  const year = useAppSelector(timeYearSelector);
  const { isLoading, isError } = useListDayOffsQuery(year);
  const dayOffs = useAppSelector(timeDayOffsSelector);
  const [createDayOff] = useCreateDayOffMutation();
  const [deleteDayOff] = useDeleteDayOffMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
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
        await createDayOff(date).unwrap();
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

  return (
    <div className={styles.tabPanel}>
      <Card view="outlined" className={styles.card}>
        <SectionHeader
          title="Дни отдыха"
          meta={dayOffs.length > 0 ? String(dayOffs.length) : undefined}
          actions={
            <Button view="action" size="m" onClick={() => setIsDialogOpen(true)}>
              <Icon data={Plus} size={16} />
              Добавить
            </Button>
          }
        />

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
            description="Добавьте отпуск, отгул или больничный — эти дни выпадут из рабочего календаря."
          />
        )}

        {!isLoading && dayOffs.length > 0 && (
          <ul className={styles.dayOffList}>
            {dayOffs.map((dayOff) => (
              <li key={dayOff.id} className={styles.dayOffRow}>
                <Text>{formatDate(dayOff.date)}</Text>
                <Button
                  view="flat-danger"
                  size="s"
                  aria-label={`Удалить ${formatDate(dayOff.date)}`}
                  onClick={() => setDayOffToRemove(dayOff)}
                >
                  <Icon data={TrashBin} size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <Dialog.Header caption="Добавить дни отдыха" />
        <Dialog.Body>
          <RangeDatePicker
            className={styles.rangePicker}
            value={selectedRange}
            onUpdate={setSelectedRange}
          />
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
              {formatDate(dayOffToRemove.date)} снова станет рабочим или выходным по календарю.
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
