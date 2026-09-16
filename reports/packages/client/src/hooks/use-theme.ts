import type { RootState } from '../store';
import { setTheme } from '../store';

import { useAppDispatch, useAppSelector } from '.';

export const useTheme = () => {
  const dispatch = useAppDispatch();
  const isDark = useAppSelector((state: RootState) => state.theme.isDark);

  const toggleTheme = () => {
    dispatch(setTheme({ isDark: !isDark }));
  };

  return { isDark, toggleTheme };
};
