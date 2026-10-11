'use client';

import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { FieldShell, describedBy, type FieldShellProps } from './FieldShell';

export interface SelectFieldProps extends FieldShellProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'className'> {
  size?: 'lg' | 'md';
  options: ReadonlyArray<{ value: string; label: string }>;
}

/** Liste déroulante native (meilleure sur mobile) avec l'apparence des champs. */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { id: idProp, label, optional, labelNote, hideLabel, hint, error, message, messagesOutside, className, size = 'lg', options, ...selectProps },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `field-${autoId.replace(/:/g, '')}`;
  return (
    <FieldShell id={id} label={label} optional={optional} labelNote={labelNote} hideLabel={hideLabel}
      hint={hint} error={error} message={message} messagesOutside={messagesOutside} className={className}>
      <div className="relative">
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { hint, error, message })}
          className={`sf-control ${size === 'md' ? 'sf-control--md' : ''}`}
          {...selectProps}
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <IconChevronDown size={20} stroke={2} aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[color:var(--field-ink)]" />
      </div>
    </FieldShell>
  );
});
