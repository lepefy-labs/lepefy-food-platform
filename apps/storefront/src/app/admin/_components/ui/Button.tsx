import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'ghost';
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  /**
   * 'md' (défaut, inchangé) pour un bouton texte normal ; 'sm' pour les cas
   * icon-only (Fase C-bis — sans ça, le padding px-4/py-2 par défaut rendait
   * les boutons d'action de ligne disproportionnés). 'sm' garde un padding
   * de 6px autour d'une icône ~14-16px, soit une cible tactile ≥24×24px
   * (audit accessibilité 17/07, §9 AUDIT_ADMIN_UIUX.md).
   */
  size?: Size;
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

const SIZE_CLASS: Record<Size, string> = {
  md: 'px-4 py-2 text-sm gap-2',
  sm: 'p-1.5 text-xs gap-1',
};

/**
 * Bottone condiviso (stile ispirato a TailAdmin — solo riferimento visivo,
 * nessun codice riusato da `_tailadmin-staging/`). Adottato per la prima
 * volta in Fase C-bis (dashboard commandes — vedi OrdersTable.tsx).
 */
export default function Button({
  variant = 'primary',
  size = 'md',
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
      className={`inline-flex items-center justify-center rounded-lg
                  font-medium transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className}`}
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
