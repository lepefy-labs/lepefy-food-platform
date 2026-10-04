import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IconBuildingBank, IconCreditCard, IconPlayerPause, IconAlertTriangle } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { aggregateTenantAiUsage, type AiRawUsageRow } from '@/lib/ai/productUsage';
import { formatPlanPrice, getTenantBillingSnapshot } from '@/lib/admin/platformBilling';
import { getTenantServiceState } from '@/lib/billing/tenantServiceState';
import { loadTenantPayments } from '@/lib/billing/platformSubscriptions';
import {
  MODULE_LABELS,
  coveredMonth,
  formatBillingDate,
  formatBillingMonth,
  plural,
  subscriptionState,
  transferReference,
  type SubscriptionRow,
} from '@/lib/billing/subscriptionRules';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import CopyableValue from '../../_components/ui/CopyableValue';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const BADGE = {
  suspended: { label: 'Suspendu', cls: 'bg-red-100 text-red-700' },
  overdue: { label: 'Paiement en retard', cls: 'bg-amber-100 text-amber-800' },
  due_soon: { label: 'À renouveler', cls: 'bg-amber-50 text-amber-700' },
  active: { label: 'Actif', cls: 'bg-green-100 text-green-700' },
  undefined: { label: 'Échéance non définie', cls: 'bg-gray-100 text-gray-600' },
} as const;

export default async function BillingPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const supabase = createServiceClient();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, subscription_status, subscription_paid_until, stripe_payment_link, bank_iban, bank_beneficiary, bank_bic')
    .eq('slug', slug)
    .single();

  if (error || !tenant) redirect('/admin');

  const [billing, serviceState, payments, aiUsageResult] = await Promise.all([
    getTenantBillingSnapshot(tenant),
    getTenantServiceState(tenant.id),
    loadTenantPayments(tenant.id),
    supabase
      .from('ai_usage_monthly_by_tenant')
      .select('endpoint, total_calls')
      .eq('tenant_id', tenant.id)
      .gte('month', new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()),
  ]);

  // Without migration 144 nothing can really suspend the tenant: describe the
  // due date only.
  const subscription: SubscriptionRow = serviceState.subscription ?? {
    status: 'active',
    suspended_at: null,
    suspension_mode: 'manual',
    paid_until: billing.paidUntil,
    grace_days: 15,
  };
  const state = subscriptionState(subscription);
  const badge = BADGE[state.kind];
  const aiUsage = aggregateTenantAiUsage((aiUsageResult.data ?? []) as AiRawUsageRow[]);
  const aiUsageTotal = aiUsage.reduce((sum, row) => sum + row.usageCount, 0);
  const price = formatPlanPrice(billing.monthlyPriceCents, billing.currency);
  const amountPlain = (billing.monthlyPriceCents / 100).toFixed(2).replace('.', ',');
  const month = coveredMonth(subscription);
  const reference = transferReference(slug, month);
  const coveredLabel = formatBillingMonth(month);

  return (
    <div className="max-w-3xl">
      <AdminPageHeader title="Abonnement" description={`${billing.planName} · ${price} HT / mois`} />

      {state.kind === 'suspended' && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <IconPlayerPause size={18} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <strong>Abonnement suspendu{state.suspendedBy === 'automatic' ? ' automatiquement' : ''}.</strong> Boutique, événementiel, carte digitale,
            paiements en ligne, Nala et avis sont hors ligne. Un paiement par carte rétablit le service immédiatement ; un virement, dès sa réception par Lepefy.
            {serviceState.suspensionReason && <span className="block text-xs">Motif : {serviceState.suspensionReason}</span>}
          </p>
        </div>
      )}
      {state.kind === 'overdue' && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <IconAlertTriangle size={18} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <strong>Échéance dépassée depuis {plural(state.daysOverdue, 'jour')}</strong> ({formatBillingDate(subscription.paid_until)}).{' '}
            {state.autoSuspendAt
              ? <>Sans paiement, le service sera suspendu le <strong>{formatBillingDate(state.autoSuspendAt)}</strong>.</>
              : <>Votre service reste actif pour l&apos;instant : réglez l&apos;abonnement pour éviter une suspension.</>}
          </p>
        </div>
      )}
      {state.kind === 'due_soon' && state.daysLeft !== null && (
        <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>{state.daysLeft === 0 ? 'Échéance aujourd’hui' : `Échéance dans ${plural(state.daysLeft, 'jour')}`}</strong> ({formatBillingDate(subscription.paid_until)}).
          Réglez l&apos;abonnement pour éviter toute interruption.
        </div>
      )}
      {serviceState.suspendedModules.length > 0 && (
        <p role="status" className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          Module{serviceState.suspendedModules.length > 1 ? 's' : ''} suspendu{serviceState.suspendedModules.length > 1 ? 's' : ''} par Lepefy :{' '}
          {serviceState.suspendedModules.map((module) => MODULE_LABELS[module]).join(', ')}.
        </p>
      )}

      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-start justify-between gap-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{tenant.name}</p>
          <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
            <p className="text-xs text-gray-500">Payé jusqu&apos;au</p>
            <p className="mt-0.5 font-semibold text-gray-900 dark:text-white">{formatBillingDate(subscription.paid_until)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
            <p className="text-xs text-gray-500">Montant mensuel</p>
            <p className="mt-0.5 font-semibold text-gray-900 dark:text-white">{price} HT</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
            <p className="text-xs text-gray-500">Prochain paiement</p>
            <p className="mt-0.5 font-semibold capitalize text-gray-900 dark:text-white">{coveredLabel}</p>
          </div>
        </div>
        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="mb-2 text-xs font-medium text-gray-500">Modules inclus</p>
          <div className="flex flex-wrap gap-2">
            {billing.features.map((feature) => (
              <span key={feature.key} className="inline-flex rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300">
                {feature.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Régler l&apos;abonnement</h2>
      <p className="mb-3 text-xs text-gray-500">
        Un paiement couvre le mois de <strong className="font-medium text-gray-700 dark:text-gray-300">{coveredLabel}</strong> : il prolonge l&apos;abonnement jusqu&apos;à la fin de ce mois.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><IconCreditCard size={18} stroke={1.8} aria-hidden="true" />Carte bancaire</p>
          <p className="mb-4 mt-1 text-xs text-gray-500">Paiement Stripe sécurisé. L&apos;échéance est prolongée automatiquement dès le paiement.</p>
          {billing.stripePaymentLink ? (
            <a href={billing.stripePaymentLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: 'var(--admin-primary)' }}>
              Payer par carte — {price}
            </a>
          ) : (
            <p className="text-xs italic text-gray-400">Lien non encore configuré. <a href={`mailto:${billing.supportEmail}`} className="underline">Contactez Lepefy</a>.</p>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><IconBuildingBank size={18} stroke={1.8} aria-hidden="true" />Virement bancaire</p>
          <p className="mb-3 mt-1 text-xs text-gray-500">Sans commission. L&apos;échéance est prolongée par Lepefy à réception (1–2 jours ouvrés).</p>
          {billing.bankIban ? (
            <div className="space-y-1.5 rounded-xl bg-gray-50 p-3 text-xs dark:bg-gray-950">
              {billing.bankBeneficiary && <p className="text-gray-600 dark:text-gray-300"><span className="text-gray-400">Bénéficiaire</span> {billing.bankBeneficiary}</p>}
              <CopyableValue label="IBAN" value={billing.bankIban} />
              {billing.bankBic && <CopyableValue label="BIC" value={billing.bankBic} />}
              <CopyableValue label="Montant" value={amountPlain} />
              <CopyableValue label="Référence" value={reference} />
              <p className="pt-1 text-[11px] text-gray-400">Indiquez exactement cette référence : elle identifie votre établissement et le mois payé.</p>
            </div>
          ) : (
            <p className="text-xs italic text-gray-400">Coordonnées bancaires non encore configurées. <a href={`mailto:${billing.supportEmail}`} className="underline">Contactez Lepefy</a>.</p>
          )}
        </div>
      </div>

      {payments.length > 0 && (
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Derniers paiements</h2>
          <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-gray-700 dark:text-gray-300">{formatBillingDate(payment.paidAt)} · {payment.source === 'stripe' ? 'Carte' : 'Virement'}</span>
                <span className="text-gray-500">{formatPlanPrice(payment.amountCents, payment.currency)} · jusqu&apos;au {formatBillingDate(payment.paidUntilAfter)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-violet-100 bg-violet-50/60 p-5 dark:border-violet-900/50 dark:bg-violet-950/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Intelligence artificielle</h2><span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-violet-700 shadow-sm">Inclus</span></div>
            <p className="mt-2 text-2xl font-bold">{aiUsageTotal}</p>
            <p className="mt-0.5 text-xs text-gray-500">utilisations ce mois · aucun coût supplémentaire actuellement</p>
          </div>
          <Link href="/admin/ai-usage" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100">Voir l’utilisation IA</Link>
        </div>
      </section>

      {billing.source === 'legacy_tenant' && (
        <p className="mt-4 text-xs text-amber-600">Configuration d’abonnement en mode compatibilité. La migration plateforme doit être appliquée par Lepefy.</p>
      )}

      <p className="mt-8 border-t border-gray-100 pt-6 text-xs text-gray-400 dark:border-gray-800">
        Pour toute question sur la facturation, contactez <a href={`mailto:${billing.supportEmail}`} className="underline">{billing.supportEmail}</a>.
      </p>
    </div>
  );
}
