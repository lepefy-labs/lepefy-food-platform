import type { AdminTone } from './tokens';

/**
 * Domain state → label + semantic tone, shared by every admin badge so the same
 * state always looks the same. Add a domain here instead of mapping colours in
 * a page. Tones mean: info = new / in flow, warning = needs work, urgent =
 * time-critical, danger = failure or blocked, success = done, neutral = inert.
 */
export interface AdminStatusMeta { label: string; tone: AdminTone }

export const ORDER_STATUS_META: Record<string, AdminStatusMeta> = {
  new: { label: 'Nouveau', tone: 'info' },
  preparing: { label: 'En préparation', tone: 'warning' },
  ready_for_pickup: { label: 'Prêt à retirer', tone: 'success' },
  shipped: { label: 'Expédié', tone: 'info' },
  delivered: { label: 'Livré', tone: 'success' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
  stock_conflict: { label: 'Conflit de stock', tone: 'danger' },
};

export const ORDER_STATUS_LABELS_IT: Record<string, string> = {
  new: 'Nuovo',
  preparing: 'In preparazione',
  ready_for_pickup: 'Pronto per ritiro',
  shipped: 'Spedito',
  delivered: 'Consegnato',
  cancelled: 'Annullato',
  stock_conflict: 'Conflitto di stock',
};

export const PAYMENT_STATUS_META: Record<string, AdminStatusMeta> = {
  paid: { label: 'Payé', tone: 'success' },
  pending: { label: 'En attente', tone: 'warning' },
  failed: { label: 'Échoué', tone: 'danger' },
  refunded: { label: 'Remboursé', tone: 'neutral' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
};

export function statusMeta(registry: Record<string, AdminStatusMeta>, status: string | null | undefined): AdminStatusMeta {
  if (!status) return { label: '—', tone: 'neutral' };
  return registry[status] ?? { label: status, tone: 'neutral' };
}
