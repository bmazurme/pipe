import { Display, Moon, Sun } from '@gravity-ui/icons';

import { ThemeMode } from '../providers/ThemeProvider';

export const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
export const THEME_ICON: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Display,
};
export const THEME_TITLE: Record<ThemeMode, string> = {
  light: 'Светлая тема',
  dark: 'Тёмная тема',
  system: 'Системная тема',
};
export const THEME_SHORT: Record<ThemeMode, string> = {
  light: 'светлая',
  dark: 'тёмная',
  system: 'системная',
};
