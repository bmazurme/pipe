import { useState } from 'react';
import { Dialog, DialogBody, DialogFooter, DialogHeader, Select } from '@gravity-ui/uikit';

import { defaultExportSort, type ExportSort, type ExportSortDirection, type ExportSortField } from '../../utils/export-report';

import reportStyle from './report.module.css';

const fieldOptions: { value: ExportSortField; content: string }[] = [
  { value: 'number', content: 'Номер задачи' },
  { value: 'name', content: 'Наименование задачи' },
  { value: 'status', content: 'Статус задачи' },
  { value: 'time', content: 'Часы' },
];

const directionOptions: { value: ExportSortDirection; content: string }[] = [
  { value: 'asc', content: 'По возрастанию' },
  { value: 'desc', content: 'По убыванию' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onExport: (sort: ExportSort) => void;
};

// The sort is asked for before every export: the file is written in exactly the order chosen here.
function ExportDialog({ open, onClose, onExport }: Props) {
  const [field, setField] = useState<ExportSortField>(defaultExportSort.field);
  const [direction, setDirection] = useState<ExportSortDirection>(defaultExportSort.direction);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader caption="Выгрузка в Excel" />
      <DialogBody>
        <div className={reportStyle.exportForm}>
          <Select
            label="Сортировать по"
            value={[field]}
            onUpdate={([value]) => setField(value as ExportSortField)}
            options={fieldOptions}
            width="max"
          />
          <Select
            label="Порядок"
            value={[direction]}
            onUpdate={([value]) => setDirection(value as ExportSortDirection)}
            options={directionOptions}
            width="max"
          />
        </div>
      </DialogBody>
      <DialogFooter
        onClickButtonCancel={onClose}
        onClickButtonApply={() => onExport({ field, direction })}
        textButtonApply="Выгрузить"
        textButtonCancel="Отмена"
      />
    </Dialog>
  );
}

export default ExportDialog;
