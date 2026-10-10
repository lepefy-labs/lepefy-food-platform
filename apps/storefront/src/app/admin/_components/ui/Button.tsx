import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-a-brand text-a-on-brand hover:bg-a-brand-hover',
  // Neutral bordered action: the default for every non-primary action.
  secondary: 'border border-a-border-strong bg-a-surface text-a-text hover:bg-a-hover',
  // Brand-tinted secondary, kept for existing callers.
  outline: 'border border-a-brand bg-a-surface text-a-brand-fg hover:bg-a-brand-soft',
  ghost: 'bg-transparent text-a-text-2 hover:bg-a-hover hover:text-a-text',
  danger: 'bg-tone-danger-solid text-white hover:opacity-90',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: 'min-h-10 px-4 text-sm gap-2',
  // Icon-only and row actions: still a ≥36px touch target.
  sm: 'min-h-9 min-w-9 px-2.5 text-sm gap-1.5',
};

/** Class string shared by <Button>, <ButtonLink> and any element styled as a button. */
export function buttonClasses({ variant = 'primary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus',
    'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    SIZE_CLASS[size],
    VARIANT_CLASS[variant],
    className,
  );
}

function Spinner() {
  return <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/** Admin button (Admin Design System V2). Defaults to type="button" so it never submits a form by accident. */
export default function Button({ variant = 'primary', size = 'md', loading = false, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClasses({ variant, size, className })} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; disabled?: boolean };

/** A navigation that looks like a button (e.g. « Nouvelle commande »). */
export function ButtonLink({ variant = 'secondary', size = 'md', disabled, className, ...rest }: ButtonLinkProps) {
  return <Link aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} className={buttonClasses({ variant, size, className })} {...rest} />;
}

/** External link (new tab) styled as a button. */
export function ButtonAnchor({ variant = 'secondary', size = 'md', className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <a className={buttonClasses({ variant, size, className })} {...rest} />;
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: an icon-only control must have an accessible name. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
}

export function IconButton({ label, icon, variant = 'ghost', loading = false, disabled, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClasses({ variant, size: 'sm', className: cn('px-0', className) })} {...rest}>
      {loading ? <Spinner /> : icon}
    </button>
  );
}
