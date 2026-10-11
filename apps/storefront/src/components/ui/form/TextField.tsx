'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { FieldShell, describedBy, type FieldShellProps } from './FieldShell';

export interface TextFieldProps extends FieldShellProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> {
  /** 'lg' = 52 px (formulaires principaux), 'md' = 48 px. */
  size?: 'lg' | 'md';
  /** Icône décorative à gauche (aria-hidden). */
  leading?: ReactNode;
  /** Élément à droite : indicateur de chargement, bouton d'effacement… */
  trailing?: ReactNode;
  inputClassName?: string;
  /** id supplémentaire pour aria-describedby (ex. annonce de résultats). */
  describedById?: string;
}

/**
 * Champ texte du storefront : libellé visible, aide, erreur et état reliés
 * au champ (aria-describedby / aria-invalid). Compatible react-hook-form
 * (`{...register('email')}`) grâce à forwardRef.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    id: idProp, label, optional, labelNote, hideLabel, hint, error, message, messagesOutside, className,
    size = 'lg', leading, trailing, inputClassName, describedById, ...inputProps
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `field-${autoId.replace(/:/g, '')}`;
  return (
    <FieldShell id={id} label={label} optional={optional} labelNote={labelNote} hideLabel={hideLabel}
      hint={hint} error={error} message={message} messagesOutside={messagesOutside} className={className}>
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--field-hint)]" aria-hidden="true">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { hint, error, message }, describedById)}
          className={[
            'sf-control',
            size === 'md' ? 'sf-control--md' : '',
            leading ? 'sf-control--leading' : '',
            trailing ? 'sf-control--trailing' : '',
            inputClassName ?? '',
          ].join(' ')}
          {...inputProps}
        />
        {trailing && <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">{trailing}</span>}
      </div>
    </FieldShell>
  );
});
