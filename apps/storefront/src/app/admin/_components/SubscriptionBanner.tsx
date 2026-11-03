import { IconAlertTriangle, IconArrowRight, IconCreditCard, IconPlayerPause } from '@tabler/icons-react';
import { ButtonLink } from './ui/Button';
import {
  MODULE_LABELS,
  formatBillingDate,
  plural,
  shouldWarnTenant,
  subscriptionState,
} from '@/lib/billing/subscriptionRules';
import type { TenantServiceState } from '@/lib/billing/tenantServiceState';

/**
 * Admin-wide billing action: one high-priority warning for the subscription,
 * independent of the suspension policy; module suspensions remain separate.
 * Payment confirmation and suspension enforcement belong to existing services.
 */
export default function SubscriptionBanner({ serviceState, canViewBilling }: { serviceState: TenantServiceState; canViewBilling: boolean }) {
  const state = subscriptionState(serviceState.subscription);
  const blocked = serviceState.suspended;
  const warn = shouldWarnTenant(state);
  const imminent = !blocked && state.autoSuspendAt !== null && state.daysUntilAutoSuspend !== null
    && state.daysUntilAutoSuspend <= 7;

  let title: string | null = null;
  let detail: string | null = null;

  if (blocked) {
    title = 'Abonnement suspendu';
    detail = 'Boutique, événementiel, carte digitale et paiements en ligne sont hors ligne. L’administration est limitée à l’abonnement et à la consultation des commandes.';
  } else if (state.kind === 'overdue') {
    title = 'Votre abonnement a expiré';
    detail = `Échéance dépassée depuis ${plural(state.daysOverdue, 'jour')}.`;
  } else if (state.kind === 'due_soon') {
    title = 'Votre abonnement arrive à échéance';
    detail = state.daysLeft === 0
      ? 'Échéance aujourd’hui.'
      : `Échéance dans ${plural(state.daysLeft ?? 0, 'jour')}.`;
  }

  if (imminent && state.autoSuspendAt) {
    const suspension = state.daysUntilAutoSuspend === 0
      ? 'Suspension automatique aujourd’hui'
      : `Suspension automatique dans ${plural(state.daysUntilAutoSuspend!, 'jour')}`;
    detail = `${detail ? detail + ' ' : ''}${suspension} (${formatBillingDate(state.autoSuspendAt)}) sans paiement.`;
    title ??= 'Votre abonnement nécessite un paiement';
  }

  const showBilling = blocked || warn;
  const hasModules = serviceState.suspendedModules.length > 0;

  if (!showBilling && !hasModules) return null;

  return (
    <>
      {showBilling && title && (
        <div
          role={blocked ? 'alert' : 'status'}
          className={`mb-4 flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center ${blocked
            ? 'border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg'
            : state.kind === 'overdue' || imminent
              ? 'border-tone-urgent-border bg-tone-urgent-bg text-tone-urgent-fg'
              : 'border-tone-warning-border bg-tone-warning-bg text-tone-warning-fg'}`}
        >
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
            {blocked
              ? <IconPlayerPause size={22} stroke={1.8} className="shrink-0" aria-hidden="true" />
              : <IconAlertTriangle size={22} stroke={1.8} className="shrink-0" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="font-semibold">{title}</p>
              {detail && <p className="mt-0.5 leading-5">{detail}</p>}
            </div>
          </div>
          {canViewBilling && (
            <ButtonLink variant="primary" href="/admin/billing" className="min-h-11 w-full shrink-0 gap-2 sm:w-auto">
              <IconCreditCard size={18} stroke={1.8} aria-hidden="true" />
              Régler maintenant
              <IconArrowRight size={16} stroke={1.8} aria-hidden="true" />
            </ButtonLink>
          )}
        </div>
      )}
      {hasModules && !blocked && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-a-border bg-a-surface-2 px-4 py-3 text-sm text-a-text-2">
          <IconPlayerPause size={18} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            Module{serviceState.suspendedModules.length > 1 ? 's' : ''} suspendu{serviceState.suspendedModules.length > 1 ? 's' : ''} par Lepefy :{' '}
            {serviceState.suspendedModules.map((module) => MODULE_LABELS[module]).join(', ')}. Contactez Lepefy pour plus d’informations.
          </p>
        </div>
      )}
    </>
  );
}
