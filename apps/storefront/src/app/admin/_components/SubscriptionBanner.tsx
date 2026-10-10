import Link from 'next/link';
import { IconAlertTriangle, IconPlayerPause } from '@tabler/icons-react';
import {
  MODULE_LABELS,
  formatBillingDate,
  plural,
  shouldWarnTenant,
  subscriptionState,
} from '@/lib/billing/subscriptionRules';
import type { TenantServiceState } from '@/lib/billing/tenantServiceState';

/**
 * Admin-wide strip: subscription suspended, automatic suspension within the
 * warning window, or modules suspended by the platform. Server component.
 */
export default function SubscriptionBanner({ serviceState, canViewBilling }: { serviceState: TenantServiceState; canViewBilling: boolean }) {
  const state = subscriptionState(serviceState.subscription);
  const payLink = canViewBilling
    ? <Link href="/admin/billing" className="ml-1 font-semibold underline underline-offset-2">Régler l&apos;abonnement</Link>
    : null;

  if (serviceState.suspended) {
    return (
      <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-tone-danger-border bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
        <IconPlayerPause size={18} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          <strong>Abonnement suspendu.</strong> Boutique, événementiel, carte digitale et paiements en ligne sont hors ligne ;
          l&apos;administration est limitée à l&apos;abonnement et à la consultation des commandes.{payLink}
        </p>
      </div>
    );
  }

  const parts: React.ReactNode[] = [];
  if (shouldWarnTenant(state) && state.autoSuspendAt && state.daysUntilAutoSuspend !== null) {
    parts.push(
      <div key="auto" role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-tone-warning-border bg-tone-warning-bg px-4 py-3 text-sm text-tone-warning-fg">
        <IconAlertTriangle size={18} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          <strong>
            {state.daysUntilAutoSuspend === 0
              ? 'Suspension automatique aujourd’hui'
              : `Suspension automatique dans ${plural(state.daysUntilAutoSuspend, 'jour')}`}
          </strong>{' '}
          ({formatBillingDate(state.autoSuspendAt)}) faute de paiement de l&apos;abonnement.{payLink}
        </p>
      </div>,
    );
  }
  if (serviceState.suspendedModules.length > 0) {
    parts.push(
      <div key="modules" role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-a-border bg-a-surface-2 px-4 py-3 text-sm text-a-text-2">
        <IconPlayerPause size={18} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          Module{serviceState.suspendedModules.length > 1 ? 's' : ''} suspendu{serviceState.suspendedModules.length > 1 ? 's' : ''} par Lepefy :{' '}
          {serviceState.suspendedModules.map((module) => MODULE_LABELS[module]).join(', ')}. Contactez Lepefy pour plus d&apos;informations.
        </p>
      </div>,
    );
  }
  return parts.length > 0 ? <>{parts}</> : null;
}
