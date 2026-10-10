import type { ReactNode } from 'react';
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconAlertOctagon } from '@tabler/icons-react';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';
import { TONE_BADGE_CLASS } from './Badge';

const ICONS: Record<AdminTone, typeof IconInfoCircle> = {
  info: IconInfoCircle,
  success: IconCircleCheck,
  warning: IconAlertTriangle,
  urgent: IconAlertTriangle,
  danger: IconAlertOctagon,
  neutral: IconInfoCircle,
};

interface InlineAlertProps {
  tone?: AdminTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Link or button on the right (« Réessayer », « Voir »). */
  action?: ReactNode;
  className?: string;
}

/** Persistent message inside a page or a dialog. Danger alerts are announced (role="alert"). */
export default function InlineAlert({ tone = 'info', title, children, action, className }: InlineAlertProps) {
  const Icon = ICONS[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-[10px] border px-3 py-2.5 text-sm', TONE_BADGE_CLASS[tone], className)}>
      <Icon size={18} stroke={1.8} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(Boolean(title) && 'mt-0.5', 'leading-6')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center font-semibold">{action}</div>}
    </div>
  );
}

/** Error line under a form or an action; renders nothing without a message. */
export function ErrorText({ message, className }: { message: string | null | undefined; className?: string }) {
  if (!message) return null;
  return <p role="alert" className={cn('text-sm font-medium text-tone-danger-fg', className)}>{message}</p>;
}
