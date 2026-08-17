import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const VARIANT_CLASS: Record<Variant, string> = {
  // --color-primary-dark (pas --color-primary) : audit accessibilité 17/07
  // (§3.1 AUDIT_ADMIN_UIUX.md) — blanc sur le vert tenant seul est 3.4:1,
  // sous le seuil AA 4.5:1 ; -dark passe à ≈5.3:1.
  primary: 'text-white bg-[var(--color-primary-dark)] hover:opacity-90',
  outline:
    'border border-[var(--color-primary-dark)] text-[var(--color-primary-dark)] bg-transparent hover:bg-[var(--color-primary-light)]',
  ghost: 'text-gray-700 dark:text-gray-300 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
};

/**
 * Bottone condiviso (stile ispirato a TailAdmin — solo riferimento visivo,
 * nessun codice riusato da `_tailadmin-staging/`). Non ancora adottato nelle
 * pagine esistenti: crea solo il componente, pronto per le fasi successive.
 */
export default function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2
                  text-sm font-medium transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      )}
      {children}
    </button>
  );
}
