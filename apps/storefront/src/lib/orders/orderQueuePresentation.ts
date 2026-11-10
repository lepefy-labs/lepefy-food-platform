import type { AdminTone } from '@/lib/admin/tokens';
import type { OrderOperation, PriorityGroup } from './adminOrderOperations';

// Presentation rules of the Admin → Commandes work queue (tone of a group,
// whether it starts collapsed, how loud a row's next action is). Pure and
// client-safe: the classifier (`classifyOrderOperation`) stays the only source
// of groups, flags and actions; nothing here decides what an order needs.

/** Tone of each priority group header (semantic tones only, never a page colour). */
export const PRIORITY_GROUP_TONE: Record<PriorityGroup, AdminTone> = {
  action_required: 'danger',
  preparation_overdue: 'urgent',
  pickup_overdue: 'urgent',
  preparing: 'warning',
  to_ship: 'warning',
  shipping: 'info',
  pickup_ready: 'success',
  finished: 'neutral',
};

/** Groups that follow their course without the team: collapsed in the general work queue. */
const PASSIVE_GROUPS: ReadonlySet<PriorityGroup> = new Set<PriorityGroup>(['shipping', 'finished']);

export interface QueueGroupContext {
  /** Active `view` (KPI card, quick view or « Contrôles » chip); '' for the general queue. */
  view: string;
  /** A search, a status or a closure filter is applied: the user looks for specific orders. */
  targeted: boolean;
}

/**
 * Initial state of a group: groups that need the team are open; regular
 * shipments in transit and finished orders start collapsed in the general
 * queue (count kept visible). An explicit view or a targeted search opens every group.
 */
export function defaultGroupCollapsed(group: PriorityGroup, context: QueueGroupContext): boolean {
  if (context.view || context.targeted) return false;
  return PASSIVE_GROUPS.has(group);
}

/** Key of the defaults above: the user's own open/closed choices reset only when it changes. */
export function queueGroupContextKey(context: QueueGroupContext): string {
  return `${context.view}|${context.targeted ? 1 : 0}`;
}

export type ActionEmphasis = 'primary' | 'outline' | 'secondary' | 'ghost';

/**
 * Visual weight of a row's next action (`operation.action` from the classifier):
 * - primary (solid): the order is late, blocked or flagged urgent and the user can act;
 * - outline: the normal next step of a work group (Préparer, Expédier…);
 * - secondary: consultation (Voir le suivi, or « Voir la commande » without `orders.manage`);
 * - ghost: finished orders.
 * Only a minority of rows get a solid button, so urgent work stands out.
 */
export function orderActionEmphasis(operation: Pick<OrderOperation, 'group' | 'flags' | 'action'>, canManage: boolean): ActionEmphasis {
  if (operation.group === 'finished') return 'ghost';
  const { action } = operation;
  if (!canManage && action.intent !== 'tracking') return 'secondary';
  if (!action.primary) return 'secondary';
  if (operation.flags.has('urgent')) return 'primary';
  return 'outline';
}

/** « 12 » when the whole group is on screen, « 12 · 4 sur cette page » otherwise. */
export function groupCountLabel(onPage: number, total: number | undefined): { count: number; pageNote: string | null } {
  const count = total !== undefined && total > onPage ? total : onPage;
  return { count, pageNote: count > onPage ? `${onPage} sur cette page` : null };
}
