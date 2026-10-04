/**
 * Pure subscription rules shared by the tenant billing page, the platform
 * console, the service-state engine and unit tests. The period computations
 * mirror the SQL of migration 144 (subscription_month_end,
 * subscription_next_paid_until, tenant_subscription_suspended_at): the
 * database stays authoritative, these only preview and describe.
 *
 * Months end at 23:59:59 UTC, the convention of the existing rows.
 */

export const MODULE_KEYS = ['shop', 'events', 'digital_card', 'ai', 'reviews'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  shop: 'Boutique',
  events: 'Événementiel',
  digital_card: 'Carte digitale',
  ai: 'Nala et IA',
  reviews: 'Avis clients',
};

export type SuspensionMode = 'manual' | 'automatic';

/** Days before an automatic suspension when warnings start. */
export const SUSPENSION_WARNING_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value);
}

/** Last second (UTC) of the month containing `at`. */
export function monthEnd(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1) - 1000);
}

/**
 * New paid-until date after a payment.
 * - no paid_until → end of the payment month;
 * - suspended with arrears → end of the payment month (months without service
 *   are not charged);
 * - otherwise → end of the month following the paid_until month.
 */
export function nextPaidUntil(paidUntil: Date | null, paidAt: Date, wasSuspended: boolean): Date {
  if (!paidUntil) return monthEnd(paidAt);
  if (wasSuspended && paidUntil.getTime() < paidAt.getTime()) return monthEnd(paidAt);
  return monthEnd(new Date(monthEnd(paidUntil).getTime() + 1000));
}

export interface SubscriptionRow {
  status: string;
  suspended_at: string | null;
  suspension_mode: SuspensionMode;
  paid_until: string | null;
  grace_days: number;
}

/** When the automatic policy suspends (null in manual mode or without a date). */
export function autoSuspendAt(row: Pick<SubscriptionRow, 'suspension_mode' | 'paid_until' | 'grace_days'>): Date | null {
  if (row.suspension_mode !== 'automatic' || !row.paid_until) return null;
  return new Date(new Date(row.paid_until).getTime() + Math.max(0, row.grace_days) * DAY_MS);
}

/** Mirror of tenant_subscription_suspended_at(). */
export function isSuspendedAt(row: SubscriptionRow, at: Date): { suspended: boolean; by: 'manual' | 'automatic' | null } {
  const suspendedAt = row.suspended_at ? new Date(row.suspended_at).getTime() : -Infinity;
  if (row.status === 'suspended' && suspendedAt <= at.getTime()) return { suspended: true, by: 'manual' };
  const auto = autoSuspendAt(row);
  if (auto && at.getTime() > auto.getTime()) return { suspended: true, by: 'automatic' };
  return { suspended: false, by: null };
}

export type SubscriptionStateKind = 'suspended' | 'overdue' | 'due_soon' | 'active' | 'undefined';

export interface SubscriptionState {
  kind: SubscriptionStateKind;
  suspendedBy: 'manual' | 'automatic' | null;
  /** Whole days past paid_until (overdue / suspended). */
  daysOverdue: number;
  /** Whole days until paid_until (due_soon / active). */
  daysLeft: number | null;
  autoSuspendAt: Date | null;
  /** Days until the automatic suspension, when it is scheduled and not reached. */
  daysUntilAutoSuspend: number | null;
}

function wholeDays(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / DAY_MS);
}

export function subscriptionState(row: SubscriptionRow | null, now: Date = new Date()): SubscriptionState {
  if (!row) {
    return { kind: 'undefined', suspendedBy: null, daysOverdue: 0, daysLeft: null, autoSuspendAt: null, daysUntilAutoSuspend: null };
  }
  const auto = autoSuspendAt(row);
  const { suspended, by } = isSuspendedAt(row, now);
  const paidUntilMs = row.paid_until ? new Date(row.paid_until).getTime() : null;
  const daysOverdue = paidUntilMs !== null && now.getTime() > paidUntilMs ? Math.max(1, Math.ceil((now.getTime() - paidUntilMs) / DAY_MS)) : 0;
  const daysLeft = paidUntilMs !== null && now.getTime() <= paidUntilMs ? wholeDays(now.getTime(), paidUntilMs) : null;
  const daysUntilAutoSuspend = auto && !suspended ? Math.max(0, Math.ceil((auto.getTime() - now.getTime()) / DAY_MS)) : null;
  const base = { suspendedBy: by, daysOverdue, daysLeft, autoSuspendAt: auto, daysUntilAutoSuspend };
  if (suspended) return { kind: 'suspended', ...base };
  if (paidUntilMs === null) return { kind: 'undefined', ...base };
  if (daysOverdue > 0) return { kind: 'overdue', ...base };
  if (daysLeft !== null && daysLeft <= SUSPENSION_WARNING_DAYS) return { kind: 'due_soon', ...base };
  return { kind: 'active', ...base };
}

/** Admin banner: suspended, or an automatic suspension within the warning window. */
export function shouldWarnTenant(state: SubscriptionState): boolean {
  if (state.kind === 'suspended') return true;
  return state.daysUntilAutoSuspend !== null && state.daysUntilAutoSuspend <= SUSPENSION_WARNING_DAYS;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatBillingDate(at: Date | string | null): string {
  if (!at) return '—';
  return DATE_FMT.format(typeof at === 'string' ? new Date(at) : at);
}

export function formatBillingMonth(at: Date): string {
  return MONTH_FMT.format(at);
}

/** First month a payment made now would cover (mirror of the renewal rule). */
export function coveredMonth(row: SubscriptionRow | null, now: Date = new Date()): Date {
  const paidUntil = row?.paid_until ? new Date(row.paid_until) : null;
  const suspended = row ? isSuspendedAt(row, now).suspended : false;
  const end = nextPaidUntil(paidUntil, now, suspended);
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
}

/** Bank transfer reference: tenant + covered month, e.g. "LEPEFY CHLOEFOOD 2026-10". */
export function transferReference(slug: string, month: Date): string {
  const tenant = slug.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'TENANT';
  const period = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
  return `LEPEFY ${tenant} ${period}`;
}

/** French messages for the RPC exception codes of migration 144. */
export const SUBSCRIPTION_ERROR_MESSAGES: Record<string, string> = {
  reason_required: 'Indiquez un motif (3 caractères minimum).',
  actor_required: 'Auteur de l’action introuvable.',
  subscription_not_found: 'Ce tenant n’a pas d’abonnement (tenant_subscriptions).',
  tenant_not_found: 'Tenant introuvable.',
  already_suspended: 'Ce tenant est déjà suspendu.',
  reactivate_still_overdue: 'La suspension automatique s’appliquerait encore : corrigez l’échéance ou passez en mode manuel avant de réactiver.',
  paid_until_required: 'Indiquez une date d’échéance.',
  invalid_payment_link: 'Le lien de paiement doit commencer par https://.',
  invalid_mode: 'Mode de suspension invalide.',
  invalid_grace_days: 'Le délai doit être compris entre 0 et 365 jours.',
  invalid_module: 'Module inconnu.',
  module_already_suspended: 'Ce module est déjà suspendu.',
  module_not_suspended: 'Ce module n’est pas suspendu.',
  invalid_action: 'Action inconnue.',
  invalid_amount: 'Montant invalide.',
  invalid_paid_at: 'Date de paiement invalide (pas dans le futur).',
  invalid_source: 'Source de paiement invalide.',
};

/** Maps a Postgres/PostgREST error to a French message (unknown → generic). */
export function subscriptionErrorMessage(error: { message?: string } | null | undefined): string {
  const code = error?.message?.trim() ?? '';
  return SUBSCRIPTION_ERROR_MESSAGES[code] ?? 'Opération impossible. Vérifiez que la migration 144 est appliquée.';
}

/** True when a Supabase error means the 144 schema is not there yet. */
export function isMissingLifecycleSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '')
    || /does not exist|could not find/i.test(error.message ?? '');
}

/** What a suspended tenant's team keeps: pay the subscription, read existing orders. */
export const SUSPENDED_ADMIN_PERMISSIONS = ['orders.view', 'billing.view'] as const;

export function isAdminPathAllowedWhenSuspended(pathname: string): boolean {
  return pathname === '/admin'
    || pathname.startsWith('/admin/orders/')
    || pathname === '/admin/billing'
    || pathname.startsWith('/admin/securite');
}

/** Admin API calls a suspended tenant keeps: read-only orders and billing. */
export function isAdminApiAllowedWhenSuspended(permission: string, method: string): boolean {
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  return read && (SUSPENDED_ADMIN_PERMISSIONS as readonly string[]).includes(permission);
}
