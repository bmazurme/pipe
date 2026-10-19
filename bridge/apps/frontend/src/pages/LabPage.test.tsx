import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { describe, expect, it } from 'vitest';

import { LabPage } from './LabPage';

describe('LabPage', () => {
  it('is a placeholder: the title, a "скоро" tag, and nothing to call or configure', () => {
    render(
      <ThemeProvider theme="light">
        <LabPage />
      </ThemeProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Lab' })).toBeInTheDocument();
    expect(screen.getByText('скоро')).toBeInTheDocument();
    expect(screen.getByText('Раздел в разработке')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
