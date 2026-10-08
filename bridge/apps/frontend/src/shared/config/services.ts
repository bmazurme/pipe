import {
  Bucket,
  BookOpen,
  Clock,
  Comments,
  FaceRobot,
  House,
  Key,
  Lock,
  MagicWand,
  Rocket,
  ShieldKeyhole,
  TrashBin,
} from '@gravity-ui/icons';
import type { IconData } from '@gravity-ui/uikit';

export interface ServiceLink {
  id: string;
  title: string;
  /** One line explaining the service, shown on the home page cards. */
  description: string;
  icon: IconData;
  path: string;
}

/**
 * The single source of truth for what this app offers. The sidebar, the burger
 * menu and the home page all read it, so a new service (or a renamed one)
 * shows up in every entry point at once instead of being added to each by hand.
 */
export const SERVICES: ServiceLink[] = [
  {
    id: 'storage',
    title: 'Storage',
    description: 'Быстрый обмен файлами между вашими устройствами.',
    icon: Bucket,
    path: '/storage',
  },
  {
    id: 'purge',
    title: 'Purge',
    description: 'Замена слов в тексте по словарю «ключ — значение».',
    icon: TrashBin,
    path: '/purge',
  },
  {
    id: 'time',
    title: 'Time',
    description: 'Рабочий календарь, дни отдыха и отчёты по задачам.',
    icon: Clock,
    path: '/time',
  },
  {
    id: 'worker',
    title: 'Worker',
    description: 'Запуск ИИ-агента (Claude, GPT, DeepSeek, Qwen) над посылкой из общего файлового хранилища.',
    icon: FaceRobot,
    path: '/worker',
  },
  {
    id: 'chat',
    title: 'Chat',
    description: 'Диалог с моделью (Claude, GPT, DeepSeek, Qwen) напрямую, без посылки и без редактирования файлов.',
    icon: Comments,
    path: '/chat',
  },
  {
    id: 'vpn',
    title: 'VPN',
    description: 'Статус туннеля worker → AI-провайдеры, его настройка и ключи worker.',
    icon: ShieldKeyhole,
    path: '/vpn',
  },
  {
    id: 'improve',
    title: 'Improve',
    description: 'Самоулучшение: задачи из GitHub issues уходят в worker, результат — PR; запуск вручную или по расписанию.',
    icon: Rocket,
    path: '/improve',
  },
  {
    id: 'context',
    title: 'Context',
    description: 'Сохранённый контекст для задач ИИ-агента: заметки о проекте и правила, которые можно прикрепить при запуске.',
    icon: BookOpen,
    path: '/context',
  },
  {
    id: 'keys',
    title: 'Keys',
    description: 'Пары RSA-ключей для шифрования посылок: генерация в браузере, приватный ключ остаётся у вас.',
    icon: Lock,
    path: '/keys',
  },
  {
    id: 'secrets',
    title: 'Secrets',
    description: 'Личное хранилище секретов — пары «имя — значение», зашифрованные на сервере.',
    icon: Key,
    path: '/secrets',
  },
];

/** Announced but not built yet — rendered inert wherever services are listed. */
export const SOON_SERVICES: Omit<ServiceLink, 'path'>[] = [
  {
    id: 'rag',
    title: 'RAG',
    description: 'Поиск по своим документам с ответами на естественном языке.',
    icon: MagicWand,
  },
];

export const HOME_LINK = {
  id: 'home',
  title: 'Главная',
  icon: House,
  path: '/',
} as const;
