import { ThemeProvider } from '@gravity-ui/uikit';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

export function renderWithTheme(ui: ReactElement, options?: RenderOptions) {
  return render(<ThemeProvider theme="light">{ui}</ThemeProvider>, options);
}
