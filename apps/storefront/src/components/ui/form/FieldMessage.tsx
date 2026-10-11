import type { ReactNode } from 'react';
import { IconAlertCircle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';

export type FieldMessageTone = 'error' | 'success' | 'info';

const TONE: Record<FieldMessageTone, { color: string; Icon: typeof IconAlertCircle }> = {
  error: { color: 'var(--field-danger)', Icon: IconAlertCircle },
  success: { color: 'var(--field-success)', Icon: IconCircleCheck },
  info: { color: 'var(--field-info)', Icon: IconInfoCircle },
};

/**
 * Message placé juste sous un champ : icône + texte, jamais la couleur seule.
 * L'id est référencé par aria-describedby du champ.
 */
export function FieldMessage({ id, tone, children }: { id?: string; tone: FieldMessageTone; children: ReactNode }) {
  const { color, Icon } = TONE[tone];
  return (
    <p id={id} className="flex items-start gap-1.5 text-[13px] font-semibold leading-snug" style={{ color }}>
      <Icon size={17} stroke={2} className="mt-px shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
