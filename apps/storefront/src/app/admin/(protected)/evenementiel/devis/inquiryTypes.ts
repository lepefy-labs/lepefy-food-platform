import type { ServiceInquiry, ServiceInquiryStatus } from '@lepefy/types';

export interface InquiryWithService extends ServiceInquiry {
  service_offerings: { title: string; slug: string } | null;
}

export type InquiryFilter = 'all' | 'new' | 'actionable' | 'followup' | 'done';

export const INQUIRY_STATUSES: ServiceInquiryStatus[] = [
  'nouveau',
  'a_contacter',
  'contacte',
  'devis_envoye',
  'accepte',
  'refuse',
  'clos',
];

export const STATUS_LABELS: Record<ServiceInquiryStatus, string> = {
  nouveau: 'Nouveau',
  a_contacter: 'À contacter',
  contacte: 'Contacté',
  devis_envoye: 'Devis envoyé',
  accepte: 'Accepté',
  refuse: 'Refusé',
  clos: 'Clos',
};

export const STATUS_PRIORITY: Record<ServiceInquiryStatus, number> = {
  nouveau: 0,
  a_contacter: 1,
  contacte: 2,
  devis_envoye: 3,
  accepte: 4,
  refuse: 5,
  clos: 6,
};

export function elapsedLabel(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

export function isOldActionable(inquiry: InquiryWithService): boolean {
  if (!['nouveau', 'a_contacter'].includes(inquiry.status)) return false;
  return Date.now() - new Date(inquiry.created_at).getTime() >= 24 * 60 * 60 * 1000;
}
