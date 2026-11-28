// S11: the rotation calendar and the state of the backup key's copies, judged. Pure: the service stores what the owner marked and what the key
// checks reported, this decides what is worth saying. Nothing here rotates anything — rotating needs the owner's hands and a runbook
// (docs/key-rotation.md); the calendar only makes sure nobody forgets that a year has passed.

export type RotationStatus = 'ok' | 'warn' | 'bad';

export type RotationKey =
  'jwt' | 'enc-key' | 'age-key' | 'telegram-bot' | 'db-password';

export interface CatalogEntry {
  key: RotationKey;
  label: string;
  // 0 = not on a calendar (the age key is judged by its verified copies instead).
  intervalDays: number;
  // What changing it does, so the reminder is not a surprise: «everyone signs in again» is fine on a Sunday, not in the middle of a deploy.
  effect: string;
}

export const CATALOG: CatalogEntry[] = [
  {
    key: 'jwt',
    label: 'JWT_SECRET и REFRESH_JWT_SECRET',
    intervalDays: 365,
    effect: 'все сессии и токены входа перестают действовать — войти заново',
  },
  {
    key: 'enc-key',
    label: 'CREDENTIALS_ENC_KEY (шифрование токенов и секретов в базе)',
    intervalDays: 365,
    effect:
      'без перешифровки значения под старым ключом не читаются; порядок — в docs/key-rotation.md',
  },
  {
    key: 'age-key',
    label: 'Ключ age для бэкапов (расшифровка)',
    intervalDays: 0,
    effect:
      'без ключа бэкап не восстановить; нужны минимум две отдельно хранимые копии, обе проверены расшифровкой',
  },
  {
    key: 'telegram-bot',
    label: 'Токен Telegram-бота',
    intervalDays: 365,
    effect:
      'бот управляет роутером и переключением: смена токена в BotFather и в настройках bridge, пока не сменили — тревоги не идут',
  },
  {
    key: 'db-password',
    label: 'Пароль Postgres',
    intervalDays: 365,
    effect:
      'меняется в базе, в стеке bridge и на реплике одновременно; на минуту bridge недоступен',
  },
];

export const ROTATION_WARN_DAYS = 30;
// Reminded about an overdue rotation at most this often.
export const ROTATION_REMIND_DAYS = 7;
// A copy of the age key counts only while it decrypted the latest backup recently: a key in a drawer that nobody has tried is a hope.
export const KEY_CHECK_WARN_DAYS = 150;
export const KEY_CHECK_BAD_DAYS = 180;
export const KEY_COPIES_WANTED = 2;

const DAY = 86_400_000;
const days = (ms: number) => Math.floor(ms / DAY);

export interface ItemState {
  key: RotationKey;
  intervalDays: number;
  lastRotatedAt: Date | null;
}

export interface ItemAssessment {
  status: RotationStatus;
  reasons: string[];
  dueAt: string | null;
  daysLeft: number | null;
}

export function assessItem(
  item: ItemState,
  now: Date = new Date(),
): ItemAssessment {
  if (item.intervalDays <= 0) {
    return { status: 'ok', reasons: [], dueAt: null, daysLeft: null };
  }

  if (!item.lastRotatedAt) {
    return {
      status: 'warn',
      reasons: [
        'Когда ключ меняли в последний раз, неизвестно — отметьте дату (или смените и отметьте)',
      ],
      dueAt: null,
      daysLeft: null,
    };
  }

  const due = item.lastRotatedAt.getTime() + item.intervalDays * DAY;
  const left = Math.ceil((due - now.getTime()) / DAY);

  if (left < 0) {
    return {
      status: 'bad',
      reasons: [`Смена просрочена на ${-left} дн (раз в ${item.intervalDays})`],
      dueAt: new Date(due).toISOString(),
      daysLeft: left,
    };
  }

  if (left <= ROTATION_WARN_DAYS) {
    return {
      status: 'warn',
      reasons: [`Смена через ${left} дн`],
      dueAt: new Date(due).toISOString(),
      daysLeft: left,
    };
  }

  return {
    status: 'ok',
    reasons: [],
    dueAt: new Date(due).toISOString(),
    daysLeft: left,
  };
}

export interface CopyState {
  label: string;
  lastCheckAt: Date;
  ok: boolean;
  lastOkAt: Date | null;
  error: string | null;
}

export interface CopiesAssessment {
  status: RotationStatus;
  reasons: string[];
  // Distinct copies that decrypted a backup within KEY_CHECK_BAD_DAYS.
  verified: number;
}

export function assessCopies(
  copies: CopyState[],
  now: Date = new Date(),
): CopiesAssessment {
  const bad: string[] = [];
  const warn: string[] = [];
  let verified = 0;

  if (copies.length === 0) {
    return {
      status: 'warn',
      reasons: [
        'Ни одна копия ключа age не проверялась расшифровкой бэкапа (infra/backup/key-check.sh)',
      ],
      verified: 0,
    };
  }

  for (const copy of copies) {
    if (!copy.ok) {
      bad.push(
        `Копия «${copy.label}» не расшифровала последний бэкап: ${copy.error || 'причина не названа'}`,
      );
    }

    if (!copy.lastOkAt) continue;

    const age = days(now.getTime() - copy.lastOkAt.getTime());

    if (age > KEY_CHECK_BAD_DAYS)
      bad.push(`Копия «${copy.label}» не проверялась ${age} дн`);
    else {
      verified += 1;

      if (age > KEY_CHECK_WARN_DAYS)
        warn.push(
          `Копию «${copy.label}» пора проверить: ${age} дн с последней проверки`,
        );
    }
  }

  if (verified < KEY_COPIES_WANTED) {
    warn.push(
      `Проверенных копий ключа ${verified}, нужно ${KEY_COPIES_WANTED}: потеря единственной копии — это потеря всех бэкапов`,
    );
  }

  return {
    status: bad.length > 0 ? 'bad' : warn.length > 0 ? 'warn' : 'ok',
    reasons: [...bad, ...warn],
    verified,
  };
}

// The encryption key's extra fact: values still under an older key mean a rotation was started and not finished.
export function assessEncKey(
  base: ItemAssessment,
  pending: number | null,
  currentKeyId: string | null,
): ItemAssessment {
  if (pending === null || pending === 0) return base;

  const reasons = [
    `${pending} значений ещё под старым ключом (сейчас пишется под ${currentKeyId ?? 'текущим'}) — выполните перешифровку (docs/key-rotation.md)`,
    ...base.reasons,
  ];

  return { ...base, status: base.status === 'bad' ? 'bad' : 'warn', reasons };
}

export function worst(...statuses: RotationStatus[]): RotationStatus {
  return statuses.includes('bad')
    ? 'bad'
    : statuses.includes('warn')
      ? 'warn'
      : 'ok';
}

// Telegram: only overdue items and a failed key check; «due in 20 days» is for the Dashboard.
export function rotationAlert(label: string, reasons: string[]): string {
  return `🔑 ${label}: ${reasons[0]}${reasons.length > 1 ? ` (и ещё ${reasons.length - 1})` : ''}. Порядок — docs/key-rotation.md.`;
}
