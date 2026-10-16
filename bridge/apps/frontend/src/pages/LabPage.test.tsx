import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';

import { LabPage } from './LabPage';

function renderPage() {
  return render(
    <ThemeProvider theme="light">
      <LabPage />
    </ThemeProvider>,
  );
}

describe('LabPage', () => {
  it('renders as a stub: status, current domains, the plan, and no live data to fetch', () => {
    renderPage();

    expect(screen.getByText('Lab')).toBeTruthy();
    expect(screen.getByText('MVP')).toBeTruthy();
    expect(screen.getByText('Катер (boat)')).toBeTruthy();
    expect(screen.getByText('Самолёт (aircraft)')).toBeTruthy();
    expect(screen.getByText('Lab/README.md')).toBeTruthy();
    expect(screen.getByText('Lab/IMPLEMENTATION_PLAN.md')).toBeTruthy();
  });
});
