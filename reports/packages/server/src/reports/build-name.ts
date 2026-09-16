import { format } from 'date-fns';

export function buildName() {
  const now = new Date();
  const month = format(now, 'MM');  // '12' (двузначное)
  const year = format(now, 'yyyy'); // '2025'

  return `output_${month}.${year}.csv`;
}

