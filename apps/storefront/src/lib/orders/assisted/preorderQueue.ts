import type { CheckoutSessionStatus } from '@lepefy/types';
import { formatOperationalDuration, formatSince } from '@/lib/orders/adminOrderOperations';

// Work queue of assisted preorders (Admin → Précommandes). Pure and
// client-safe: list, counters, sort and detail page read the same rules.
// It never changes a preorder; status transitions stay in the assisted API.

export type PreorderGroup = 'to_verify' | 'expired' | 'draft' | 'waiting' | 'finished';

export const PREORDER_GROUP_ORDER: readonly PreorderGroup[] = ['to_verify', 'expired', 'draft', 'waiting', 'finished'];

export const PREORDER_GROUP_LABELS: Record<PreorderGroup, string> = {
  to_verify: 'À vérifier',
  expired: 'Liens expirés',
  draft: 'Brouillons',
  waiting: 'Attente client',
  finished: 'Terminées',
};

/** List views kept in the query string (`to_treat` is the default). */
export type PreorderView = 'to_treat' | 'waiting' | 'completed' | 'cancelled' | 'all';
export const PREORDER_VIEWS: readonly PreorderView[] = ['to_treat', 'waiting', 'completed', 'cancelled', 'all'];

/** Groups that need the team ("À traiter"); waiting for the customer is not an action. */
export const TO_TREAT_GROUPS: readonly PreorderGroup[] = ['to_verify', 'expired', 'draft'];

export const ACTIVE_PREORDER_STATUSES: CheckoutSessionStatus[] = ['draft', 'open', 'awaiting_verification', 'expired'];

/** A warning is shown only past these delays (hours). */
export const DECLARED_PAYMENT_ALERT_HOURS = 24;
export const LINK_EXPIRY_ALERT_HOURS = 24;
export const LINK_UNOPENED_ALERT_HOURS = 24;

export interface PreorderQueueInput {
  id: string;
  status: CheckoutSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  declaredAt: string | null;
  declaredLabel: string | null;
  linkIssuedAt: string | null;
  /** Last `link_opened` event, when loaded. */
  lastOpenedAt?: string | null;
  shippingPending: boolean;
}

export interface PreorderNextAction { label: string; primary: boolean }

export interface PreorderOperation {
  group: PreorderGroup;
  action: PreorderNextAction;
  /** Neutral context line ("Lien envoyé il y a 18 h · pas encore consulté"). */
  context: string | null;
  /** Shown only for a real condition (old declaration, link expiring, missing shipping). */
  warning: string | null;
  /** Timestamp ordering the preorder inside its group. */
  operationalAt: string;
}

function hoursBetween(from: string | null | undefined, to: Date): number | null {
  const time = Date.parse(from ?? '');
  return Number.isFinite(time) ? (to.getTime() - time) / 3_600_000 : null;
}

export function preorderGroup(status: CheckoutSessionStatus): PreorderGroup {
  if (status === 'awaiting_verification') return 'to_verify';
  if (status === 'expired') return 'expired';
  if (status === 'draft') return 'draft';
  if (status === 'open') return 'waiting';
  return 'finished';
}

export function classifyPreorder(input: PreorderQueueInput, now: Date): PreorderOperation {
  const group = preorderGroup(input.status);
  const opened = input.lastOpenedAt ? `lien consulté ${formatSince(input.lastOpenedAt, now)}` : null;

  if (group === 'to_verify') {
    const declaredAt = input.declaredAt ?? input.updatedAt;
    const age = hoursBetween(declaredAt, now) ?? 0;
    const line = `${input.declaredLabel ?? 'Paiement'} déclaré ${formatSince(declaredAt, now)}`;
    return {
      group, operationalAt: declaredAt, action: { label: 'Vérifier le paiement', primary: true },
      context: age >= DECLARED_PAYMENT_ALERT_HOURS ? null : line,
      warning: age >= DECLARED_PAYMENT_ALERT_HOURS ? line : null,
    };
  }
  if (group === 'expired') {
    const expiredAt = input.expiresAt ?? input.updatedAt;
    return {
      group, operationalAt: expiredAt, action: { label: 'Nouveau lien', primary: true }, warning: null,
      context: `Expiré ${formatSince(expiredAt, now)} · ${opened ?? 'lien jamais consulté'}`,
    };
  }
  if (group === 'draft') {
    return {
      group, operationalAt: input.createdAt,
      action: { label: input.shippingPending ? 'Compléter' : 'Envoyer le lien', primary: true },
      context: input.shippingPending ? null : `Brouillon créé ${formatSince(input.createdAt, now)}`,
      warning: input.shippingPending ? 'Frais de livraison à calculer' : null,
    };
  }
  if (group === 'waiting') {
    const hoursLeft = -(hoursBetween(input.expiresAt, now) ?? -Infinity);
    const sinceIssued = hoursBetween(input.linkIssuedAt, now);
    const expiringSoon = Number.isFinite(hoursLeft) && hoursLeft > 0 && hoursLeft <= LINK_EXPIRY_ALERT_HOURS;
    const unopenedTooLong = !input.lastOpenedAt && sinceIssued !== null && sinceIssued >= LINK_UNOPENED_ALERT_HOURS;
    const sent = input.linkIssuedAt ? `Lien envoyé ${formatSince(input.linkIssuedAt, now)}` : 'Lien actif';
    const parts = [sent, opened ?? 'pas encore consulté'];
    return {
      group, operationalAt: input.expiresAt ?? input.createdAt,
      action: expiringSoon || unopenedTooLong ? { label: 'Relancer', primary: false } : { label: 'Voir', primary: false },
      context: parts.join(' · '),
      warning: expiringSoon ? `Expire dans ${formatOperationalDuration(hoursLeft)}` : null,
    };
  }
  return {
    group, operationalAt: input.updatedAt, warning: null, context: null,
    action: { label: input.status === 'completed' ? 'Voir la commande' : 'Voir', primary: false },
  };
}

function timeOf(value: string | null | undefined): number {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : 0;
}

/** Group order, then oldest operational time first (finished: most recent first), then creation and id. */
export function comparePreorders(a: { input: PreorderQueueInput; operation: PreorderOperation }, b: { input: PreorderQueueInput; operation: PreorderOperation }): number {
  const group = PREORDER_GROUP_ORDER.indexOf(a.operation.group) - PREORDER_GROUP_ORDER.indexOf(b.operation.group);
  if (group !== 0) return group;
  const direction = a.operation.group === 'finished' ? -1 : 1;
  return (timeOf(a.operation.operationalAt) - timeOf(b.operation.operationalAt)) * direction
    || (timeOf(a.input.createdAt) - timeOf(b.input.createdAt)) * direction
    || a.input.id.localeCompare(b.input.id);
}

export function parsePreorderView(raw: string | null | undefined): PreorderView {
  if (raw === 'active') return 'to_treat';
  return PREORDER_VIEWS.includes(raw as PreorderView) ? raw as PreorderView : 'to_treat';
}

/** "P-9C2E11A0" (or its 8 hex) → bounds on checkout_sessions.id for a prefix search. */
export function preorderReferenceRange(query: string): { from: string; to: string } | null {
  const match = /^(?:p-?)?([0-9a-f]{8})$/i.exec(query.trim());
  if (!match) return null;
  const prefix = match[1]!.toLowerCase();
  return { from: `${prefix}-0000-0000-0000-000000000000`, to: `${prefix}-ffff-ffff-ffff-ffffffffffff` };
}
