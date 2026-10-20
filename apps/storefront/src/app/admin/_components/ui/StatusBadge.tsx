import { ORDER_STATUS_LABELS_IT, ORDER_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import Badge from './Badge';

/** Order status badge — label and tone come from lib/admin/statusRegistry.ts. */
export default function StatusBadge({
  status,
  lang = 'fr',
  fulfillmentType,
  closureType,
}: {
  status: string;
  lang?: 'fr' | 'it';
  fulfillmentType?: 'delivery' | 'pickup';
  /** Migration 161: a cancelled order finished directly with the shop is not shown as « Annulé ». */
  closureType?: string | null;
}) {
  if (status === 'cancelled' && closureType === 'handled_externally') {
    return <Badge tone="info" dot>{lang === 'it' ? 'Gestito fuori piattaforma' : 'Traitée hors plateforme'}</Badge>;
  }
  const meta = statusMeta(ORDER_STATUS_META, status);
  const label = status === 'delivered' && fulfillmentType === 'pickup'
    ? (lang === 'it' ? 'Ritirato' : 'Retiré')
    : lang === 'it'
    ? (ORDER_STATUS_LABELS_IT[status] ?? status)
    : meta.label;

  return <Badge tone={meta.tone} dot>{label}</Badge>;
}
