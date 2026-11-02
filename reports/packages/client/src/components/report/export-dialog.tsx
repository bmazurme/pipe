import { useState } from 'react';
import { Checkbox, Dialog, DialogBody, DialogFooter, DialogHeader, Select, Text } from '@gravity-ui/uikit';

import {
  defaultExportIdentifier,
  defaultExportSort,
  type ExportIdentifier,
  type ExportSort,
  type ExportSortDirection,
  type ExportSortField,
} from '../../utils/export-report';

import reportStyle from './report.module.css';

const fieldOptions: { value: ExportSortField; content: string }[] = [
  { value: 'number', content: 'Номер задачи' },
  { value: 'created', content: 'Дата создания' },
  { value: 'name', content: 'Наименование задачи' },
  { value: 'status', content: 'Статус задачи' },
  { value: 'time', content: 'Часы' },
];

const directionOptions: { value: ExportSortDirection; content: string }[] = [
  { value: 'asc', content: 'По возрастанию' },
  { value: 'desc', content: 'По убыванию' },
];

const identifierOptions: { value: ExportIdentifier; content: string }[] = [
  { value: 'number', content: 'Номер задачи' },
  { value: 'created', content: 'Дата создания (ГГГГММДДЧЧММСС)' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onExport: (options: { sort: ExportSort; identifier: ExportIdentifier }) => void;
};

// The sort and what the task column starts with are asked for before every export: the file is written exactly as chosen here.
function ExportDialog({ open, onClose, onExport }: Props) {
  const [field, setField] = useState<ExportSortField>(defaultExportSort.field);
  const [direction, setDirection] = useState<ExportSortDirection>(defaultExportSort.direction);
  const [identifier, setIdentifier] = useState<ExportIdentifier>(defaultExportIdentifier);

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
          <fieldset className={reportStyle.exportIdentifier}>
            <Text as="legend" variant="body-2">В названии задачи указать</Text>
            {identifierOptions.map((option) => (
              <Checkbox
                key={option.value}
                checked={identifier === option.value}
                // exactly one is always chosen: ticking the other moves the tick, unticking the chosen one does nothing
                onUpdate={(checked) => checked && setIdentifier(option.value)}
              >
                {option.content}
              </Checkbox>
            ))}
          </fieldset>
        </div>
      </DialogBody>
      <DialogFooter
        onClickButtonCancel={onClose}
        onClickButtonApply={() => onExport({ sort: { field, direction }, identifier })}
        textButtonApply="Выгрузить"
        textButtonCancel="Отмена"
      />
    </Dialog>
  );
}

export default ExportDialog;
