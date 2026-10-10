import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

/** Shared look of every admin text control (input, select, textarea). */
export const inputClasses = cn(
  'w-full rounded-lg border border-a-border-strong bg-a-surface px-3 text-sm text-a-text placeholder:text-a-text-3',
  'focus:border-a-brand focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-a-focus',
  'disabled:cursor-not-allowed disabled:bg-a-disabled-bg disabled:text-a-disabled-fg',
  'aria-[invalid=true]:border-tone-danger-solid',
);

/** Text control with the standard height, for hand-written forms. */
export const controlClasses = cn(inputClasses, 'min-h-10 py-2');
export const labelClasses = 'mb-1.5 block text-sm font-semibold text-a-text';
export const hintClasses = 'mt-1.5 text-xs leading-5 text-a-text-3';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputClasses, 'min-h-10 py-2', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cn(inputClasses, 'min-h-10 py-2 pr-8', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(inputClasses, 'py-2 leading-6', className)} {...rest} />;
});

interface FormFieldProps {
  label: ReactNode;
  /** One control; it receives id, aria-describedby and aria-invalid. */
  children: ReactElement;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  className?: string;
}

/** Label + control + hint + error, wired for screen readers. */
export function FormField({ label, children, hint, error, required, optional, className }: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const controlId = (isValidElement(children) && (children.props as { id?: string }).id) || id;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: controlId,
        'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
        required: required || undefined,
      })
    : children;
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={controlId} className="mb-1.5 block text-sm font-semibold text-a-text">
        {label}
        {required && <span aria-hidden="true" className="text-tone-danger-fg"> *</span>}
        {optional && <span className="font-normal text-a-text-3"> (facultatif)</span>}
      </label>
      {control}
      {hint && <p id={hintId} className="mt-1.5 text-xs leading-5 text-a-text-3">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-tone-danger-fg">{error}</p>}
    </div>
  );
}
