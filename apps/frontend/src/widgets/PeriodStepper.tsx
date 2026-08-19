import { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '@gravity-ui/icons';
import { Button, Icon, Text } from '@gravity-ui/uikit';

import styles from './PeriodStepper.module.css';

interface PeriodStepperProps {
  /** The period currently shown, e.g. a year or a month name. */
  value: ReactNode;
  onStep: (delta: -1 | 1) => void;
  prevLabel: string;
  nextLabel: string;
  /** Reserves width for the value so the arrows don't shift as it changes. */
  valueClassName?: string;
}

/**
 * The « value » control used by every period-scoped view. The calendar, the
 * day-offs list and the report each had their own copy, so the arrow sizes and
 * the gap between them drifted apart.
 */
export function PeriodStepper({
  value,
  onStep,
  prevLabel,
  nextLabel,
  valueClassName,
}: PeriodStepperProps) {
  return (
    <div className={styles.root}>
      <Button view="flat" size="m" onClick={() => onStep(-1)} aria-label={prevLabel}>
        <Icon data={ChevronLeft} size={16} />
      </Button>
      <Text
        variant="subheader-1"
        className={[styles.value, valueClassName].filter(Boolean).join(' ')}
      >
        {value}
      </Text>
      <Button view="flat" size="m" onClick={() => onStep(1)} aria-label={nextLabel}>
        <Icon data={ChevronRight} size={16} />
      </Button>
    </div>
  );
}
