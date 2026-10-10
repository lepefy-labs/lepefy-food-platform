import { ORDER_STATUS_LABELS_IT, ORDER_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import Badge from './Badge';

/** Order status badge — label and tone come from lib/admin/statusRegistry.ts. */
export default function StatusBadge({
  status,
  lang = 'fr',
  fulfillmentType,
}: {
  status: string;
  lang?: 'fr' | 'it';
  fulfillmentType?: 'delivery' | 'pickup';
}) {
  const meta = statusMeta(ORDER_STATUS_META, status);
  const label = status === 'delivered' && fulfillmentType === 'pickup'
    ? (lang === 'it' ? 'Ritirato' : 'Retiré')
    : lang === 'it'
    ? (ORDER_STATUS_LABELS_IT[status] ?? status)
    : meta.label;

  return <Badge tone={meta.tone} dot>{label}</Badge>;
}
