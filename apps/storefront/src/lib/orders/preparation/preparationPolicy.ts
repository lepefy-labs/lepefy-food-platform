/**
 * Single rule set of "is this order prepared / packed?" (migration 160).
 * Pure and client-safe: read by the transition service (and through it the
 * Packlink sync), bulk-status, the packing and paper routes, the work-queue
 * classifier, the order detail and the dashboard. No caller re-derives these
 * rules.
 *
 * Modes come from the order's snapshot (`orders.preparation_mode`, taken when
 * preparation starts); a missing snapshot means digital/digital, i.e. exactly
 * the rules that existed before migration 160.
 *
 * Invariants:
 *  - digital checks (order_items.picked_at, cold_chain_checked_at,
 *    picking_completed_at, cold_chain_packing_checked_at, packing_completed_at)
 *    are only ever satisfied by digital actions;
 *  - "paper" is satisfied only by an explicit, named declaration
 *    (paper_preparation_completed_at, cold_chain_packing_declared_at);
 *  - "none" records no check at all — the final transition stamps
 *    preparation_unverified_at;
 *  - whatever the mode: payment, stock conflict, transition validity, a
 *    human-entered parcel count (deliveries) and tracking rules still apply.
 */

export const PREPARATION_MODES = ['digital', 'paper', 'none'] as const;
export type PreparationModeValue = (typeof PREPARATION_MODES)[number];

export interface OrderPreparationMode {
  picking: PreparationModeValue;
  cold_chain_packing: PreparationModeValue;
}

export const DIGITAL_PREPARATION: OrderPreparationMode = { picking: 'digital', cold_chain_packing: 'digital' };

export const PREPARATION_MODE_LABELS: Record<PreparationModeValue, string> = {
  digital: 'Dans Lepefy',
  paper: 'Sur papier',
  none: 'Sans confirmation',
};

export interface PreparationItem {
  storage_type?: string | null;
  picked_at?: string | null;
  cold_chain_checked_at?: string | null;
}

export interface PreparationOrder {
  status: string;
  fulfillment_type: 'delivery' | 'pickup';
  preparation_mode?: unknown;
  picking_completed_at?: string | null;
  packing_completed_at?: string | null;
  packing_parcel_count?: number | null;
  cold_chain_packing_checked_at?: string | null;
  picking_list_printed_at?: string | null;
  paper_preparation_started_at?: string | null;
  paper_preparation_completed_at?: string | null;
  cold_chain_packing_declared_at?: string | null;
  packing_started_at?: string | null;
  order_items?: PreparationItem[] | null;
  /**
   * Tenant's current mode. Applies to an order without snapshot as long as no
   * digital preparation work exists on it — e.g. paid storefront orders, which
   * are created directly « En préparation » and never go through new → preparing.
   */
  tenantPreparationMode?: OrderPreparationMode;
}

function isMode(value: unknown): value is PreparationModeValue {
  return typeof value === 'string' && (PREPARATION_MODES as readonly string[]).includes(value);
}

/** Snapshot of the order; anything unreadable is the strict digital mode. */
export function orderPreparationMode(order: Pick<PreparationOrder, 'preparation_mode'>): OrderPreparationMode {
  const raw = order.preparation_mode;
  if (!raw || typeof raw !== 'object') return DIGITAL_PREPARATION;
  const value = raw as Record<string, unknown>;
  return {
    picking: isMode(value.picking) ? value.picking : 'digital',
    cold_chain_packing: isMode(value.cold_chain_packing) ? value.cold_chain_packing : 'digital',
  };
}

const isCold = (item: PreparationItem) => item.storage_type === 'fresh' || item.storage_type === 'frozen';

/** Any digital preparation record (a ticked line, a packing write): the order is then bound to the digital mode. */
export function hasDigitalPreparationWork(order: PreparationOrder, items: PreparationItem[] | null = null): boolean {
  const lines = items ?? order.order_items ?? [];
  return lines.some((item) => item.picked_at || item.cold_chain_checked_at)
    || Boolean(order.picking_completed_at || order.packing_started_at || order.packing_completed_at || order.cold_chain_packing_checked_at);
}

export type PreparationModeSource = 'snapshot' | 'tenant' | 'default';

/**
 * Mode that rules this order: its snapshot; otherwise the tenant's current
 * mode while nothing digital was recorded on it (`source = 'tenant'`: callers
 * that write persist it as the snapshot); otherwise the strict digital mode.
 */
export function effectivePreparationMode(order: PreparationOrder, items: PreparationItem[] | null = null): { mode: OrderPreparationMode; source: PreparationModeSource } {
  if (order.preparation_mode) return { mode: orderPreparationMode(order), source: 'snapshot' };
  const tenant = order.tenantPreparationMode;
  if (!tenant || (order.status !== 'new' && order.status !== 'preparing')) return { mode: DIGITAL_PREPARATION, source: 'default' };
  if (order.status === 'new' || !hasDigitalPreparationWork(order, items)) return { mode: tenant, source: 'tenant' };
  return { mode: DIGITAL_PREPARATION, source: 'default' };
}

export type PreparationSource = 'digital' | 'paper' | 'none';

export interface PreparationState {
  mode: OrderPreparationMode;
  /** 'tenant': mode adopted from the tenant setting, to be saved on the order by the next write. */
  modeSource: PreparationModeSource;
  hasColdChain: boolean;
  /** Line-level digital progress (only meaningful when line data is known). */
  lines: { total: number; picked: number; coldRequired: number; coldChecked: number } | null;
  pickingDone: boolean;
  /** Cold-chain packing requirement satisfied (true when not applicable). */
  coldPackingDone: boolean;
  parcelsKnown: boolean;
  /** Deliveries: parcels known and cold packing done (digital/digital: packing validated). */
  packingDone: boolean;
  /** All preparation requirements of the next transition (ship / ready for pickup) are met. */
  readyForFinal: boolean;
  /** Paper flow: list printed / started and not yet declared complete. */
  paperInProgress: boolean;
  /** A final transition now would record no check (mode « sans confirmation »). */
  unverified: boolean;
}

/**
 * `items` with line timestamps gives the exact digital picking state;
 * without them (light list rows) picking_completed_at — maintained by the
 * picking route under the same rule — stands in.
 */
export function preparationState(order: PreparationOrder, items: PreparationItem[] | null = null): PreparationState {
  const { mode, source: modeSource } = effectivePreparationMode(order, items);
  const lineSource = items ?? order.order_items ?? [];
  const hasColdChain = lineSource.some(isCold);
  const delivery = order.fulfillment_type === 'delivery';
  const hasLineTimestamps = items !== null;

  let lines: PreparationState['lines'] = null;
  let digitalPicking = Boolean(order.picking_completed_at);
  if (hasLineTimestamps) {
    const cold = items.filter(isCold);
    lines = {
      total: items.length,
      picked: items.filter((item) => item.picked_at).length,
      coldRequired: cold.length,
      coldChecked: cold.filter((item) => item.cold_chain_checked_at).length,
    };
    digitalPicking = lines.total > 0 && lines.picked === lines.total && lines.coldChecked === lines.coldRequired;
  }

  const pickingDone = mode.picking === 'digital' ? digitalPicking
    : mode.picking === 'paper' ? Boolean(order.paper_preparation_completed_at)
      : lineSource.length > 0 || !hasLineTimestamps;

  const coldApplies = delivery && hasColdChain;
  const coldPackingDone = !coldApplies ? true
    : mode.cold_chain_packing === 'digital' ? Boolean(order.cold_chain_packing_checked_at)
      : mode.cold_chain_packing === 'paper' ? Boolean(order.cold_chain_packing_declared_at)
        : true;
  const parcelsKnown = (order.packing_parcel_count ?? 0) >= 1;
  const legacy = mode.picking === 'digital' && mode.cold_chain_packing === 'digital';
  // digital/digital keeps the historical rules: lists trust packing_completed_at (only written by the
  // packing panel once parcels and the cold check are valid); the transition (line data) re-checks both.
  const packingDone = delivery && (legacy
    ? Boolean(order.packing_completed_at) && (!hasLineTimestamps || (parcelsKnown && coldPackingDone))
    : parcelsKnown && coldPackingDone);

  const readyForFinal = pickingDone && (!delivery || packingDone);
  const paperInProgress = mode.picking === 'paper' && order.status === 'preparing' && !order.paper_preparation_completed_at;
  const unverified = mode.picking === 'none' || (coldApplies && mode.cold_chain_packing === 'none');

  return { mode, modeSource, hasColdChain, lines, pickingDone, coldPackingDone, parcelsKnown, packingDone, readyForFinal, paperInProgress, unverified };
}

/**
 * Blocking reasons before preparing → shipped / ready_for_pickup, in French.
 * Empty array = the preparation side allows the transition.
 */
export function preparationBlockers(order: PreparationOrder, items: PreparationItem[] | null, packing: boolean): string[] {
  const state = preparationState(order, items);
  const blockers: string[] = [];
  const lineCount = items?.length ?? order.order_items?.length ?? null;
  if (lineCount === 0) return ['La commande ne contient aucun article à préparer.'];
  if (!state.pickingDone) {
    if (state.mode.picking === 'paper') blockers.push('Préparation papier à confirmer : utilisez « Préparation terminée ».');
    else if (state.lines) {
      const parts: string[] = [];
      const unpicked = state.lines.total - state.lines.picked;
      const coldMissing = state.lines.coldRequired - state.lines.coldChecked;
      if (unpicked > 0) parts.push(`${unpicked} ligne${unpicked > 1 ? 's' : ''} non prélevée${unpicked > 1 ? 's' : ''}`);
      if (coldMissing > 0) parts.push(`${coldMissing} contrôle${coldMissing > 1 ? 's' : ''} froid manquant${coldMissing > 1 ? 's' : ''}`);
      blockers.push(`Préparation incomplète : ${parts.join(' · ')}.`);
    } else blockers.push('Préparation incomplète.');
  }
  if (packing && order.fulfillment_type === 'delivery' && !state.packingDone) {
    if (!state.parcelsKnown) blockers.push('Nombre de colis à renseigner avant l’expédition.');
    else if (!state.coldPackingDone) {
      blockers.push(state.mode.cold_chain_packing === 'paper'
        ? 'Emballage froid à confirmer (déclaration papier) avant l’expédition.'
        : 'Emballage incomplet : validez les colis et les contrôles froid avant l’expédition.');
    } else blockers.push('Emballage incomplet : validez les colis et les contrôles froid avant l’expédition.');
  }
  return blockers;
}

export type PreparationStepKey = 'to_print' | 'to_prepare' | 'printed' | 'in_progress' | 'prepared' | 'ready';

export interface PreparationStep { key: PreparationStepKey; label: string }

const STEP_LABELS: Record<PreparationStepKey, string> = {
  to_print: 'À imprimer',
  to_prepare: 'À préparer',
  printed: 'Liste imprimée',
  in_progress: 'Préparation en cours',
  prepared: 'Préparation terminée',
  ready: 'Prêt à expédier',
};

/**
 * Preparation step shown on lists, dashboard and detail (new / preparing only).
 * `tenantMode` decides the step of an order whose preparation has not started
 * yet (no snapshot): « À imprimer » in paper mode.
 */
export function preparationStep(order: PreparationOrder, tenantMode: OrderPreparationMode = DIGITAL_PREPARATION): PreparationStep | null {
  if (order.status !== 'new' && order.status !== 'preparing') return null;
  const step = (key: PreparationStepKey): PreparationStep => ({ key, label: key === 'ready' && order.fulfillment_type === 'pickup' ? 'Prête au retrait' : STEP_LABELS[key] });
  const { mode } = effectivePreparationMode({ ...order, tenantPreparationMode: order.tenantPreparationMode ?? tenantMode });
  if (order.status === 'new') return step(mode.picking === 'paper' && !order.picking_list_printed_at ? 'to_print' : 'to_prepare');
  const state = preparationState({ ...order, tenantPreparationMode: order.tenantPreparationMode ?? tenantMode });
  if (state.readyForFinal) return step('ready');
  if (state.pickingDone) return step('prepared');
  if (mode.picking === 'paper') return step(order.paper_preparation_started_at || order.picking_list_printed_at ? 'printed' : 'to_print');
  return step('in_progress');
}

/**
 * Mode adopted when « Imprimer et démarrer » touches an order: a new order, or
 * an order in preparation without snapshot whose digital work has not begun
 * (no line picked, no packing recorded), takes the tenant's current mode.
 * Anything already started keeps its snapshot (or digital).
 */
export function modeOnStart(order: PreparationOrder & { packing_started_at?: string | null }, items: PreparationItem[], tenantMode: OrderPreparationMode): OrderPreparationMode | null {
  if (order.preparation_mode) return null;
  if (order.status === 'new') return tenantMode;
  if (order.status !== 'preparing') return null;
  const digitalWorkStarted = items.some((item) => item.picked_at || item.cold_chain_checked_at)
    || Boolean(order.packing_started_at || order.packing_completed_at || order.cold_chain_packing_checked_at);
  return digitalWorkStarted ? null : tenantMode;
}

// ─── « Imprimer et démarrer » result (shared by the API and the client) ──────

export type StartSkipReason = 'not_found' | 'payment' | 'stock_conflict' | 'not_preparable' | 'conflict';

export interface StartResult {
  /** Orders now in preparation (moved from « Nouvelle » or already preparing). */
  ready: string[];
  /** Orders moved new → preparing by this call. */
  started: string[];
  skipped: Array<{ id: string; reason: StartSkipReason }>;
}

export const START_SKIP_LABELS: Record<StartSkipReason, string> = {
  not_found: 'introuvable',
  payment: 'paiement à vérifier',
  stock_conflict: 'conflit de stock',
  not_preparable: 'déjà préparée ou terminée',
  conflict: 'modifiée entre-temps, réessayez',
};
