import {
  Bucket,
  BookOpen,
  Clock,
  Comments,
  FaceRobot,
  FileZipper,
  Flask,
  House,
  Key,
  Lock,
  MagicWand,
  Pulse,
  Rocket,
  ShieldKeyhole,
  TrashBin,
} from '@gravity-ui/icons';
import type { IconData } from '@gravity-ui/uikit';

/**
 * Sidebar sections, top to bottom: what is used all day first (the AI agent), then data, then the working tools, and the
 * operations pages last. Only the sidebar and the burger group by it; the home page keeps its own order.
 */
export type NavGroup = 'agent' | 'data' | 'work' | 'system';

export const NAV_GROUP_ORDER: NavGroup[] = ['agent', 'data', 'work', 'system'];

export interface ServiceLink {
  id: string;
  title: string;
  /** One line explaining the service, shown on the home page cards. */
  description: string;
  icon: IconData;
  path: string;
  group: NavGroup;
  /** Every route behind it is limited to the deployment owner, so other accounts do not see it listed. */
  ownerOnly?: true;
  /** Announced, with a placeholder page behind it: listed with a "скоро" tag but still a real link. */
  soon?: true;
}

/**
 * The single source of truth for what this app offers. The sidebar, the burger
 * menu and the home page all read it, so a new service (or a renamed one)
 * shows up in every entry point at once instead of being added to each by hand.
 */
export const SERVICES: ServiceLink[] = [
  {
    id: 'dashboard',
    title: 'Дашборд',
    description: 'Состояние инфраструктуры: туннель, узлы кластера и бэкапы — на одной странице.',
    icon: Pulse,
    path: '/dashboard',
    group: 'system',
    ownerOnly: true,
  },
  {
    id: 'storage',
    title: 'Storage',
    description: 'Быстрый обмен файлами между вашими устройствами.',
    icon: Bucket,
    path: '/storage',
    group: 'data',
  },
  {
    id: 'purge',
    title: 'Purge',
    description: 'Замена слов в тексте по словарю «ключ — значение».',
    icon: TrashBin,
    path: '/purge',
    group: 'data',
  },
  {
    id: 'time',
    title: 'Time',
    description: 'Рабочий календарь, дни отдыха и отчёты по задачам.',
    icon: Clock,
    path: '/time',
    group: 'work',
  },
  {
    id: 'worker',
    title: 'Worker',
    description: 'Запуск ИИ-агента (Claude, GPT, DeepSeek, Qwen) над посылкой из общего файлового хранилища.',
    icon: FaceRobot,
    path: '/worker',
    group: 'agent',
  },
  {
    id: 'chat',
    title: 'Chat',
    description: 'Диалог с моделью (Claude, GPT, DeepSeek, Qwen) напрямую, без посылки и без редактирования файлов.',
    icon: Comments,
    path: '/chat',
    group: 'agent',
  },
  {
    id: 'vpn',
    title: 'VPN',
    description: 'Статус туннеля worker → AI-провайдеры, его настройка и ключи worker.',
    icon: ShieldKeyhole,
    path: '/vpn',
    group: 'system',
  },
  {
    id: 'improve',
    title: 'Improve',
    description: 'Самоулучшение: задачи из GitHub issues уходят в worker, результат — PR; запуск вручную или по расписанию.',
    icon: Rocket,
    path: '/improve',
    group: 'agent',
    ownerOnly: true,
  },
  {
    id: 'context',
    title: 'Context',
    description: 'Сохранённый контекст для задач ИИ-агента: заметки о проекте и правила, которые можно прикрепить при запуске.',
    icon: BookOpen,
    path: '/context',
    group: 'agent',
  },
  {
    id: 'keys',
    title: 'Keys',
    description: 'Пары RSA-ключей для шифрования посылок: генерация в браузере, приватный ключ остаётся у вас.',
    icon: Lock,
    path: '/keys',
    group: 'data',
  },
  {
    id: 'secrets',
    title: 'Secrets',
    description: 'Личное хранилище секретов — пары «имя — значение», зашифрованные на сервере.',
    icon: Key,
    path: '/secrets',
    group: 'data',
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Скачать последнюю версию reports с GitHub и синхронизировать его настройки с bridge.',
    icon: FileZipper,
    path: '/reports',
    group: 'work',
  },
  {
    id: 'lab',
    title: 'Lab',
    description: 'CAD, расчёты и BOM для хардварных проектов (катер, самолёт, …).',
    icon: Flask,
    path: '/lab',
    group: 'work',
    soon: true,
  },
];

/** The services an account can actually use: owner-only ones are dropped once it is known not to be the owner. */
export function visibleServices(isOwner?: boolean): ServiceLink[] {
  return isOwner === false ? SERVICES.filter((service) => !service.ownerOnly) : SERVICES;
}

/** Announced but not built yet — rendered inert wherever services are listed. */
export const SOON_SERVICES: Omit<ServiceLink, 'path' | 'group'>[] = [
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
