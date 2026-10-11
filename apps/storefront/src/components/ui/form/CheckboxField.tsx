'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/** Case à cocher 22 px, zone cliquable de 44 px minimum (libellé inclus). */
export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(function CheckboxField(
  { id: idProp, label, hint, className, ...inputProps },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `field-${autoId.replace(/:/g, '')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] leading-snug text-[color:var(--field-ink)]">
        <input ref={ref} id={id} type="checkbox" aria-describedby={hintId} className="sf-checkbox" {...inputProps} />
        <span>{label}</span>
      </label>
      {hint && <p id={hintId} className="sf-hint pl-[34px]">{hint}</p>}
    </div>
  );
});
