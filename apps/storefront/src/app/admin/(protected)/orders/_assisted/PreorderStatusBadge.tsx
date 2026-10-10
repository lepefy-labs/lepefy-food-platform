import type { CheckoutSessionStatus } from '@lepefy/types';
import { PREORDER_STATUS_LABELS } from '@lepefy/types';

const TONES: Record<CheckoutSessionStatus, string> = {
  draft: 'bg-a-hover text-a-text-2',
  open: 'bg-tone-info-bg text-tone-info-fg',
  awaiting_verification: 'bg-tone-warning-bg text-tone-warning-fg',
  completed: 'bg-tone-success-bg text-tone-success-fg',
  expired: 'bg-tone-urgent-bg text-tone-urgent-fg',
  cancelled: 'bg-tone-danger-bg text-tone-danger-fg',
};

export default function PreorderStatusBadge({ status }: { status: CheckoutSessionStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${TONES[status]}`}>
      {PREORDER_STATUS_LABELS[status]}
    </span>
  );
}
