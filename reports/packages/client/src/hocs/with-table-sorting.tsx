import { Table, withTableSorting } from '@gravity-ui/uikit';

export type RowData = {
  id: string;
  name: string;
  status: string;
  time: number;
  meta: { sort: boolean };
};

const MyTable = withTableSorting<RowData>(Table);

export default MyTable;