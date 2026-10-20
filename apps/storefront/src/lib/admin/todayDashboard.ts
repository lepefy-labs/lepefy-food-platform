import type { AdminTone } from './tokens';
import type { QueueKey } from '@/lib/orders/adminOrderOperations';
import type { OrderPreparationMode } from '@/lib/orders/preparation/preparationPolicy';

/**
 * Pure rules of the « Aujourd'hui » dashboard (/admin). Every count comes from
 * the orders work-queue classifier (one count per order and view) plus the
 * two payment queues that are not orders yet (link payments, preorders).
 * Nothing here queries or mutates.
 */

export type KpiCounts = Partial<Record<QueueKey, number>>;

export interface PriorityItem {
  key: string;
  label: string;
  detail: string;
  count: number;
  tone: AdminTone;
  href: string;
  cta: string;
}

export interface PriorityInput {
  kpis: KpiCounts;
  pendingLinkPayments: number;
  preordersToVerify: number;
}

const ORDERS = '/admin/orders';

/** Only what needs a real intervention, most severe first, zero counts dropped. */
export function buildPriorityItems({ kpis, pendingLinkPayments, preordersToVerify }: PriorityInput): PriorityItem[] {
  const n = (key: QueueKey) => kpis[key] ?? 0;
  const items: PriorityItem[] = [
    { key: 'stock_conflict', label: 'Conflits de stock', detail: 'Stock insuffisant pour au moins une ligne', count: n('stock_conflict'), tone: 'danger', href: `${ORDERS}?view=stock_conflict`, cta: 'Vérifier' },
    { key: 'incidents', label: 'Incidents de livraison', detail: 'Signalés par le transporteur', count: n('incidents'), tone: 'danger', href: `${ORDERS}?view=incidents`, cta: 'Résoudre' },
    { key: 'payment_unverified', label: 'Paiements à vérifier', detail: 'Commandes dont le paiement n’est pas confirmé', count: n('payment_unverified'), tone: 'warning', href: `${ORDERS}?view=payment_unverified`, cta: 'Vérifier' },
    { key: 'link_payments', label: 'Paiements par lien à vérifier', detail: 'Clients ayant payé hors carte, commande pas encore créée', count: pendingLinkPayments, tone: 'warning', href: ORDERS, cta: 'Vérifier' },
    { key: 'preorders', label: 'Précommandes à vérifier', detail: 'Paiement déclaré à confirmer', count: preordersToVerify, tone: 'warning', href: `${ORDERS}/precommandes`, cta: 'Vérifier' },
    { key: 'late_preparation', label: 'Préparations en retard', detail: 'Au-delà du délai fixé dans vos paramètres', count: n('late_preparation'), tone: 'urgent', href: `${ORDERS}?view=late_preparation`, cta: 'Voir' },
    { key: 'late_pickup', label: 'Retraits en retard', detail: 'Client attendu en boutique depuis longtemps', count: n('late_pickup'), tone: 'urgent', href: `${ORDERS}?view=late_pickup`, cta: 'Voir' },
    { key: 'tracking_issues', label: 'Suivis à vérifier', detail: 'Sans suivi, sans mouvement ou livraison estimée dépassée', count: n('tracking_issues'), tone: 'warning', href: `${ORDERS}?view=tracking_issues`, cta: 'Voir' },
  ];
  return items.filter((item) => item.count > 0);
}

export interface QuickAction {
  key: 'prepare' | 'print' | 'ship' | 'new_order' | 'payments';
  label: string;
  detail: string;
  href: string;
  count: number | null;
  primary: boolean;
}

export function buildQuickActions(input: {
  kpis: KpiCounts;
  mode: OrderPreparationMode;
  canManage: boolean;
  paymentsToVerify: number;
}): QuickAction[] {
  const n = (key: QueueKey) => input.kpis[key] ?? 0;
  const paper = input.mode.picking === 'paper';
  const actions: QuickAction[] = [
    { key: 'prepare', label: 'Préparer les commandes', detail: n('to_prepare') > 0 ? `${n('to_prepare')} à préparer` : 'Aucune en attente', href: `${ORDERS}/preparation`, count: n('to_prepare'), primary: true },
    {
      key: 'print', label: 'Imprimer les listes',
      detail: paper ? (n('to_print') > 0 ? `${n('to_print')} pas encore imprimée${n('to_print') > 1 ? 's' : ''}` : 'Tout est imprimé') : 'Listes individuelles et groupée',
      href: paper ? `${ORDERS}?view=to_print` : `${ORDERS}/preparation`, count: paper ? n('to_print') : null, primary: false,
    },
    { key: 'ship', label: 'Expédier les colis', detail: n('to_ship') > 0 ? `${n('to_ship')} prête${n('to_ship') > 1 ? 's' : ''} à expédier` : 'Aucun colis prêt', href: `${ORDERS}?view=to_ship`, count: n('to_ship'), primary: false },
    ...(input.canManage ? [{ key: 'new_order' as const, label: 'Nouvelle commande', detail: 'WhatsApp, téléphone, boutique', href: `${ORDERS}/new`, count: null, primary: false }] : []),
    { key: 'payments', label: 'Vérifier les paiements', detail: input.paymentsToVerify > 0 ? `${input.paymentsToVerify} en attente` : 'Rien à vérifier', href: n('payment_unverified') > 0 ? `${ORDERS}?view=payment_unverified` : ORDERS, count: input.paymentsToVerify, primary: false },
  ];
  return actions;
}

export interface RecentOrderRow {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  payment_status: string;
  fulfillment_type: 'delivery' | 'pickup';
  full_name: string | null;
  total: number | null;
  closure_type?: string | null;
}

export interface ActivityEntry { orderId: string; at: string; label: string; tone: AdminTone }

/**
 * Last update of the most recently changed orders, worded from their current
 * state (one cheap query, no history scan): it says what the order became,
 * not every intermediate event.
 */
export function describeRecentOrder(row: RecentOrderRow): ActivityEntry {
  const fresh = Math.abs(Date.parse(row.updated_at) - Date.parse(row.created_at)) < 120_000;
  const pickup = row.fulfillment_type === 'pickup';
  let label: string;
  let tone: AdminTone = 'info';
  if (fresh && row.status === 'new') label = 'Nouvelle commande';
  else if (row.status === 'stock_conflict') { label = 'Conflit de stock'; tone = 'danger'; }
  else if (row.status === 'cancelled' && row.closure_type === 'handled_externally') { label = 'Traitée hors plateforme'; tone = 'info'; }
  else if (row.status === 'cancelled') { label = 'Commande annulée'; tone = 'neutral'; }
  else if (row.status === 'delivered') { label = pickup ? 'Retrait terminé' : 'Colis livré'; tone = 'success'; }
  else if (row.status === 'shipped') label = 'Colis expédié';
  else if (row.status === 'ready_for_pickup') { label = 'Prête au retrait'; tone = 'success'; }
  else if (row.status === 'preparing') { label = 'Préparation en cours'; tone = 'warning'; }
  else if (row.payment_status === 'paid') { label = 'Paiement confirmé'; tone = 'success'; }
  else { label = 'Commande mise à jour'; tone = 'neutral'; }
  return { orderId: row.id, at: row.updated_at, label, tone };
}
