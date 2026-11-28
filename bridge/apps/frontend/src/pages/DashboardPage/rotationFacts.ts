import type { KeyCopy, RotationItem } from '../../store/api';

export function dueText(item: RotationItem): string {
  if (item.intervalDays <= 0) return '';
  if (!item.lastRotatedAt) return 'дата последней смены не отмечена';

  const left = item.daysLeft;

  if (left === null) return '';
  if (left < 0) return `просрочено на ${-left} дн`;

  return `следующая смена через ${left} дн (раз в ${item.intervalDays})`;
}

export function copyText(copy: KeyCopy, now: number = Date.now()): string {
  if (!copy.ok) return `«${copy.label}»: не расшифровала`;
  if (!copy.lastOkAt) return `«${copy.label}»: не проверена`;

  const days = Math.max(0, Math.floor((now - new Date(copy.lastOkAt).getTime()) / 86_400_000));

  return `«${copy.label}»: проверена ${days === 0 ? 'сегодня' : `${days} дн назад`}`;
}
