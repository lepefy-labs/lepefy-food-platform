import type { ReactNode } from 'react';
import { FieldMessage, type FieldMessageTone } from './FieldMessage';

export interface FieldShellProps {
  /** Libellé visible (obligatoire : jamais un simple placeholder). */
  label: ReactNode;
  /** Ajoute « (facultatif) » au libellé. */
  optional?: boolean;
  /** Précision affichée en petit après le libellé, ex. « (non modifiable) ». */
  labelNote?: ReactNode;
  /** Masque le libellé à l'écran (reste lu par les lecteurs d'écran). */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Message non bloquant sous le champ (succès ou information). */
  message?: { tone: Exclude<FieldMessageTone, 'error'>; text: ReactNode } | null;
  /**
   * Champ étroit dans une rangée (numéro, code postal) : l'erreur et l'aide
   * sont affichées par le parent sous la rangée, avec les mêmes id
   * (`fieldIds`), donc toujours reliées au champ.
   */
  messagesOutside?: boolean;
  className?: string;
}

export function fieldIds(id: string) {
  return { hint: `${id}-hint`, error: `${id}-error`, message: `${id}-message` };
}

/** aria-describedby : erreur d'abord (lue en premier), puis message et aide. */
export function describedBy(id: string, props: Pick<FieldShellProps, 'hint' | 'error' | 'message'>, extra?: string): string | undefined {
  const ids = fieldIds(id);
  const list = [props.error ? ids.error : null, props.message ? ids.message : null, props.hint ? ids.hint : null, extra ?? null]
    .filter(Boolean);
  return list.length ? list.join(' ') : undefined;
}

/** Libellé + champ + aide + message : structure commune des champs du kit. */
export function FieldShell({
  id, label, optional, labelNote, hideLabel, hint, error, message, messagesOutside, className, children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  const ids = fieldIds(id);
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'sf-label'}>
        {label}
        {optional && <span className="ml-1.5 text-[13px] font-normal text-[color:var(--field-hint)]">(facultatif)</span>}
        {labelNote && <span className="ml-1.5 text-[13px] font-normal text-[color:var(--field-hint)]">{labelNote}</span>}
      </label>
      {children}
      {!messagesOutside && error && <FieldMessage id={ids.error} tone="error">{error}</FieldMessage>}
      {!messagesOutside && message && <FieldMessage id={ids.message} tone={message.tone}>{message.text}</FieldMessage>}
      {!messagesOutside && hint && <p id={ids.hint} className="sf-hint">{hint}</p>}
    </div>
  );
}
