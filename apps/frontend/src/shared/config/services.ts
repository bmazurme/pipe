import { Bucket, Clock, House, MagicWand, TrashBin } from '@gravity-ui/icons';
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
