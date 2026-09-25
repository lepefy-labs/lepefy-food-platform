import type { CheckoutSessionStatus } from '@lepefy/types';
import { PREORDER_STATUS_LABELS } from '@lepefy/types';

const TONES: Record<CheckoutSessionStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
  open: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  awaiting_verification: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  expired: 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300',
  cancelled: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

export default function PreorderStatusBadge({ status }: { status: CheckoutSessionStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${TONES[status]}`}>
      {PREORDER_STATUS_LABELS[status]}
    </span>
  );
}
