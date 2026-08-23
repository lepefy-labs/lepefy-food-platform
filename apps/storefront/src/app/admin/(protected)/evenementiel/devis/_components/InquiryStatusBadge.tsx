import type { ServiceInquiryStatus } from '@lepefy/types';
import { STATUS_LABELS } from '../inquiryTypes';

const STATUS_CLASSES: Record<ServiceInquiryStatus, string> = {
  nouveau: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  a_contacter: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  contacte: 'bg-amber-50/70 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  devis_envoye: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  accepte: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  refuse: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  clos: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

export default function InquiryStatusBadge({ status }: { status: ServiceInquiryStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-2xs font-semibold ${STATUS_CLASSES[status]}`}>{STATUS_LABELS[status]}</span>;
}
