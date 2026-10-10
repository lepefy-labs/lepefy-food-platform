import type { ServiceInquiryStatus } from '@lepefy/types';
import { STATUS_LABELS } from '../inquiryTypes';

const STATUS_CLASSES: Record<ServiceInquiryStatus, string> = {
  nouveau: 'bg-tone-info-bg text-tone-info-fg',
  a_contacter: 'bg-tone-warning-bg text-tone-warning-fg',
  contacte: 'bg-tone-warning-bg text-tone-warning-fg',
  devis_envoye: 'bg-a-brand-soft text-a-brand-fg',
  accepte: 'bg-tone-success-bg text-tone-success-fg',
  refuse: 'bg-tone-danger-bg text-tone-danger-fg',
  clos: 'bg-a-hover text-a-text-2',
};

export default function InquiryStatusBadge({ status }: { status: ServiceInquiryStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${STATUS_CLASSES[status]}`}>{STATUS_LABELS[status]}</span>;
}
