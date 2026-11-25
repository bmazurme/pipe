import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { describe, expect, it } from 'vitest';

import type { ClaudeLimits } from '../../store/api';
import { ClaudeLimitsView } from './ClaudeLimitsView';

const NOW = Date.parse('2026-10-14T12:00:00Z');

const LIMITS: ClaudeLimits = {
  status: 'allowed_warning',
  rateLimitType: 'seven_day',
  isUsingOverage: false,
  windows: {
    five_hour: { utilization: 0.16, resetsAt: Date.parse('2026-10-14T14:00:00Z') / 1000 },
    seven_day: { utilization: 0.76, resetsAt: Date.parse('2026-10-19T12:00:00Z') / 1000 },
  },
  reportedAt: '2026-10-14T11:55:00Z',
};

const view = (props: Parameters<typeof ClaudeLimitsView>[0]) =>
  render(
    <ThemeProvider theme="light">
      <ClaudeLimitsView {...props} />
    </ThemeProvider>,
  );

describe('ClaudeLimitsView', () => {
  it('shows a bar per window with percent, reset and how fresh the data is', () => {
    view({ limits: LIMITS, now: NOW });

    expect(screen.getByRole('group', { name: 'Лимиты Claude' })).toBeTruthy();
    expect(screen.getByText('5 часов')).toBeTruthy();
    expect(screen.getByText('16% · сброс через 2 ч')).toBeTruthy();
    expect(screen.getByText('Неделя')).toBeTruthy();
    expect(screen.getByText('76% · сброс через 5 дн')).toBeTruthy();
    expect(screen.getByText(/данные 5 минут назад/)).toBeTruthy();
  });

  it('says when the limit is used up or extra usage is on', () => {
    view({ limits: { ...LIMITS, status: 'rejected', isUsingOverage: true }, now: NOW });

    expect(screen.getByText(/Лимит исчерпан/)).toBeTruthy();
    expect(screen.getByText(/доп\. использование/)).toBeTruthy();
  });

  it('shows the placeholder when nothing was reported yet, and nothing without one', () => {
    const { container, rerender } = view({ limits: null, emptyText: 'Лимиты появятся позже' });

    expect(screen.getByText('Лимиты появятся позже')).toBeTruthy();

    rerender(
      <ThemeProvider theme="light">
        <ClaudeLimitsView limits={null} />
      </ThemeProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
