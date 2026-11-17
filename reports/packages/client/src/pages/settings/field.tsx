import { useId, type ReactNode } from 'react';
import { Text } from '@gravity-ui/uikit';

import style from './settings.module.css';

type FieldProps = {
  label: string;
  // Quiet help under the control; replaced by `error` while there is one.
  hint?: ReactNode;
  error?: string;
  // Receives the id the label points at, so the control is the labelled element.
  children: (id: string) => ReactNode;
};

// A label above its control (not inside it), with the help text or the error under it — one shape for every field on the page.
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();

  return (
    <div className={style.field}>
      <label htmlFor={id} className={style.fieldLabel}>{label}</label>
      {children(id)}
      {error ? (
        <Text variant="caption-2" color="danger" className={style.fieldNote}>{error}</Text>
      ) : hint ? (
        <Text variant="caption-2" color="secondary" className={style.fieldNote}>{hint}</Text>
      ) : null}
    </div>
  );
}
