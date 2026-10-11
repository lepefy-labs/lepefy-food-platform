'use client';

import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { FieldShell, describedBy, type FieldShellProps } from './FieldShell';

export interface TextareaFieldProps extends FieldShellProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  textareaClassName?: string;
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { id: idProp, label, optional, labelNote, hideLabel, hint, error, message, messagesOutside, className, textareaClassName, ...textareaProps },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `field-${autoId.replace(/:/g, '')}`;
  return (
    <FieldShell id={id} label={label} optional={optional} labelNote={labelNote} hideLabel={hideLabel}
      hint={hint} error={error} message={message} messagesOutside={messagesOutside} className={className}>
      <textarea
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error, message })}
        className={`sf-control ${textareaClassName ?? ''}`}
        {...textareaProps}
      />
    </FieldShell>
  );
});
