import { useEffect } from 'react';
import { Select } from '@gravity-ui/uikit';

import { useListContextsQuery } from '../../store/api';

const NONE = '';

// A saved Context (the Context page) to hand to the run's worker, in front of the task. Not remembered between visits on purpose: a context
// left over from last week would go along with every run without anyone choosing it.
export function ContextSelect({ value, onChange, width }: { value: number | null; onChange: (contextId: number | null) => void; width?: 'max' }) {
  const { data } = useListContextsQuery();
  const contexts = Array.isArray(data) ? data : [];
  const known = value !== null && contexts.some((context) => context.id === value);

  // A context deleted since it was chosen is dropped from the choice rather than sent and refused.
  useEffect(() => {
    if (Array.isArray(data) && value !== null && !known) onChange(null);
  }, [data, value, known, onChange]);

  const selected = known ? String(value) : NONE;

  return (
    <Select
      size="m"
      width={width}
      label="Контекст:"
      value={[selected]}
      onUpdate={([next]) => onChange(next ? Number(next) : null)}
      options={[{ value: NONE, content: 'Без контекста' }, ...contexts.map((context) => ({ value: String(context.id), content: context.name }))]}
    />
  );
}
