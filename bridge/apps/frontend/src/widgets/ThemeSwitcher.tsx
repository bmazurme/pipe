import { Display, Moon, Sun } from '@gravity-ui/icons';
import { Button, Icon, SegmentedRadioGroup } from '@gravity-ui/uikit';

import { ThemeMode, useAppTheme } from '../app/providers/ThemeProvider';

const MODE_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const MODE_ICON: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Display,
};
const MODE_TITLE: Record<ThemeMode, string> = {
  light: 'Светлая тема',
  dark: 'Тёмная тема',
  system: 'Системная тема',
};

interface ThemeSwitcherProps {
  /** Renders a single cycling icon button instead of the full 3-way control. */
  compact?: boolean;
}

export function ThemeSwitcher({ compact }: ThemeSwitcherProps) {
  const { themeMode, setThemeMode } = useAppTheme();

  if (compact) {
    const nextMode =
      MODE_ORDER[(MODE_ORDER.indexOf(themeMode) + 1) % MODE_ORDER.length];

    return (
      <Button
        view="flat"
        title={`${MODE_TITLE[themeMode]} — нажмите для переключения`}
        onClick={() => setThemeMode(nextMode)}
      >
        <Icon data={MODE_ICON[themeMode]} size={16} />
      </Button>
    );
  }

  return (
    <SegmentedRadioGroup
      value={themeMode}
      onUpdate={(value) => setThemeMode(value as ThemeMode)}
      width="max"
    >
      {MODE_ORDER.map((mode) => (
        <SegmentedRadioGroup.Option
          key={mode}
          value={mode}
          title={MODE_TITLE[mode]}
        >
          <Icon data={MODE_ICON[mode]} size={16} />
        </SegmentedRadioGroup.Option>
      ))}
    </SegmentedRadioGroup>
  );
}
