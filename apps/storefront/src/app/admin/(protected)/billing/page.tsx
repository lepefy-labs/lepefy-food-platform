import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IconBrandPaypal, IconBuildingBank, IconCreditCard, IconPlayerPause, IconAlertTriangle } from '@tabler/icons-react';
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
  paymentSourceLabel,
  plural,
  subscriptionState,
  transferReference,
  type SubscriptionRow,
} from '@/lib/billing/subscriptionRules';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import CopyableValue from '../../_components/ui/CopyableValue';
import Badge from '../../_components/ui/Badge';
import { SUBSCRIPTION_STATE_META } from '@/lib/admin/statusRegistry';
import { applyLinkAmount } from '@/lib/payments/externalPaymentLink';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Tenant-facing wording; the tone comes from the registry. */
const STATE_LABEL = {
  suspended: 'Suspendu',
  overdue: 'Paiement en retard',
  due_soon: 'À renouveler',
  active: 'À jour',
  undefined: 'Échéance non définie',
} as const;

/** First day of the month a payment paid up to (the month it covers). */
function coveredBy(paidUntilAfter: string): Date {
  const end = new Date(paidUntilAfter);
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
}

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
    loadTenantPayments(tenant.id, 12),
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
  const badgeTone = SUBSCRIPTION_STATE_META[state.kind].tone;
  const aiUsage = aggregateTenantAiUsage((aiUsageResult.data ?? []) as AiRawUsageRow[]);
  const aiUsageTotal = aiUsage.reduce((sum, row) => sum + row.usageCount, 0);
  const price = formatPlanPrice(billing.monthlyPriceCents, billing.currency);
  const amountPlain = (billing.monthlyPriceCents / 100).toFixed(2).replace('.', ',');
  const month = coveredMonth(subscription);
  const reference = transferReference(slug, month);
  const coveredLabel = formatBillingMonth(month);
  // PayPal.me: the plan amount is prefilled; any other PayPal link is used as is.
  const paypalLink = billing.paypalUrl ? applyLinkAmount('paypal', billing.paypalUrl, billing.monthlyPriceCents / 100, billing.currency) : null;

  return (
    <div className="max-w-3xl">
      <AdminPageHeader title="Abonnement" description={`${billing.planName} · ${price} HT / mois`} />

      {state.kind === 'suspended' && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-tone-danger-border bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
          <IconPlayerPause size={18} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <strong>Abonnement suspendu{state.suspendedBy === 'automatic' ? ' automatiquement' : ''}.</strong> Boutique, événementiel, carte digitale,
            paiements en ligne, Nala et avis sont hors ligne. Un paiement par carte rétablit le service immédiatement ; un virement, dès sa réception par Lepefy.
            {serviceState.suspensionReason && <span className="block text-xs">Motif : {serviceState.suspensionReason}</span>}
          </p>
        </div>
      )}
      {state.kind === 'overdue' && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-tone-warning-border bg-tone-warning-bg px-4 py-3 text-sm text-tone-warning-fg">
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
        <div role="status" className="mb-5 rounded-xl border border-tone-warning-border bg-tone-warning-bg px-4 py-3 text-sm text-tone-warning-fg">
          <strong>{state.daysLeft === 0 ? 'Échéance aujourd’hui' : `Échéance dans ${plural(state.daysLeft, 'jour')}`}</strong> ({formatBillingDate(subscription.paid_until)}).
          Réglez l&apos;abonnement pour éviter toute interruption.
        </div>
      )}
      {serviceState.suspendedModules.length > 0 && (
        <p role="status" className="mb-5 rounded-xl border border-a-border bg-a-surface-2 px-4 py-3 text-sm text-a-text-2">
          Module{serviceState.suspendedModules.length > 1 ? 's' : ''} suspendu{serviceState.suspendedModules.length > 1 ? 's' : ''} par Lepefy :{' '}
          {serviceState.suspendedModules.map((module) => MODULE_LABELS[module]).join(', ')}.
        </p>
      )}

      <div className="mb-5 rounded-2xl border border-a-border bg-a-surface p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <p className="text-sm font-semibold text-a-text">{tenant.name}</p>
          <Badge tone={badgeTone} dot className="shrink-0">{STATE_LABEL[state.kind]}</Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-a-surface-2 p-3">
            <p className="text-xs text-a-text-3">Payé jusqu&apos;au</p>
            <p className="mt-0.5 font-semibold text-a-text">{formatBillingDate(subscription.paid_until)}</p>
          </div>
          <div className="rounded-xl bg-a-surface-2 p-3">
            <p className="text-xs text-a-text-3">Montant mensuel</p>
            <p className="mt-0.5 font-semibold text-a-text">{price} HT</p>
          </div>
          <div className="rounded-xl bg-a-surface-2 p-3">
            <p className="text-xs text-a-text-3">Prochain paiement</p>
            <p className="mt-0.5 font-semibold capitalize text-a-text">{coveredLabel}</p>
          </div>
        </div>
        <div className="mt-4 border-t border-a-border pt-4">
          <p className="mb-2 text-xs font-medium text-a-text-3">Modules inclus</p>
          <div className="flex flex-wrap gap-2">
            {billing.features.map((feature) => (
              <span key={feature.key} className="inline-flex rounded-full border border-a-border bg-a-brand-soft px-2.5 py-1 text-xs font-medium text-a-brand-fg">
                {feature.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <h2 className="mb-1 text-sm font-semibold text-a-text-2">Régler l&apos;abonnement</h2>
      <p className="mb-3 text-xs text-a-text-3">
        Un paiement couvre le mois de <strong className="font-medium text-a-text-2">{coveredLabel}</strong> : il prolonge l&apos;abonnement jusqu&apos;à la fin de ce mois.
      </p>
      <div className={`grid gap-3 ${paypalLink ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        <div className="rounded-2xl border border-a-border bg-a-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-a-text"><IconCreditCard size={18} stroke={1.8} aria-hidden="true" />Carte bancaire</p>
          <p className="mb-4 mt-1 text-xs text-a-text-3">Paiement Stripe sécurisé. L&apos;échéance est prolongée automatiquement dès le paiement.</p>
          {billing.stripePaymentLink ? (
            <a href={billing.stripePaymentLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-a-on-brand hover:opacity-90" style={{ backgroundColor: 'var(--admin-primary)' }}>
              Payer par carte — {price}
            </a>
          ) : (
            <p className="text-xs italic text-a-text-3">Lien non encore configuré. <a href={`mailto:${billing.supportEmail}`} className="underline">Contactez Lepefy</a>.</p>
          )}
        </div>

        <div className="rounded-2xl border border-a-border bg-a-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-a-text"><IconBuildingBank size={18} stroke={1.8} aria-hidden="true" />Virement bancaire</p>
          <p className="mb-3 mt-1 text-xs text-a-text-3">Sans commission. L&apos;échéance est prolongée par Lepefy à réception (1–2 jours ouvrés).</p>
          {billing.bankIban ? (
            <div className="space-y-1.5 rounded-xl bg-a-surface-2 p-3 text-xs">
              {billing.bankBeneficiary && <p className="text-a-text-2"><span className="text-a-text-3">Bénéficiaire</span> {billing.bankBeneficiary}</p>}
              <CopyableValue label="IBAN" value={billing.bankIban} />
              {billing.bankBic && <CopyableValue label="BIC" value={billing.bankBic} />}
              <CopyableValue label="Montant" value={amountPlain} />
              <CopyableValue label="Référence" value={reference} />
              <p className="pt-1 text-xs text-a-text-3">Indiquez exactement cette référence : elle identifie votre établissement et le mois payé.</p>
            </div>
          ) : (
            <p className="text-xs italic text-a-text-3">Coordonnées bancaires non encore configurées. <a href={`mailto:${billing.supportEmail}`} className="underline">Contactez Lepefy</a>.</p>
          )}
        </div>

        {paypalLink && (
          <div className="rounded-2xl border border-a-border bg-a-surface p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-a-text"><IconBrandPaypal size={18} stroke={1.8} aria-hidden="true" />PayPal</p>
            <p className="mb-3 mt-1 text-xs text-a-text-3">L&apos;échéance est prolongée par Lepefy à réception du paiement.</p>
            <a href={paypalLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-xl border border-a-border px-4 py-2.5 text-sm font-semibold text-a-text hover:bg-a-hover">
              Payer avec PayPal — {price}
            </a>
            <div className="mt-3 rounded-xl bg-a-surface-2 p-3 text-xs">
              <CopyableValue label="Note à indiquer" value={reference} />
            </div>
          </div>
        )}
      </div>

      {payments.length > 0 && (
        <section className="mt-6 rounded-2xl border border-a-border bg-a-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-a-text-2">Historique des paiements</h2>
          <ul className="divide-y divide-a-border text-sm">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block font-medium capitalize text-a-text">{formatBillingMonth(coveredBy(payment.paidUntilAfter))}</span>
                  <span className="block text-xs text-a-text-3">
                    {paymentSourceLabel(payment.source)} · reçu le {formatBillingDate(payment.paidAt)} · payé jusqu&apos;au {formatBillingDate(payment.paidUntilAfter)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-a-text">{formatPlanPrice(payment.amountCents, payment.currency)}</span>
                  <Badge tone="success">Reçu</Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-a-border bg-a-brand-soft p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Intelligence artificielle</h2><span className="rounded-full bg-a-surface px-2 py-0.5 text-xs font-semibold text-a-brand-fg shadow-sm">Inclus</span></div>
            <p className="mt-2 text-2xl font-bold">{aiUsageTotal}</p>
            <p className="mt-0.5 text-xs text-a-text-3">utilisations ce mois · aucun coût supplémentaire actuellement</p>
          </div>
          <Link href="/admin/ai-usage" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-a-border bg-a-surface px-4 py-2 text-sm font-semibold text-a-brand-fg hover:bg-a-brand-soft">Voir l’utilisation IA</Link>
        </div>
      </section>

      {billing.source === 'legacy_tenant' && (
        <p className="mt-4 text-xs text-tone-warning-fg">Configuration d’abonnement en mode compatibilité. La migration plateforme doit être appliquée par Lepefy.</p>
      )}

      <p className="mt-8 border-t border-a-border pt-6 text-xs text-a-text-3">
        Pour toute question sur la facturation, contactez <a href={`mailto:${billing.supportEmail}`} className="underline">{billing.supportEmail}</a>.
      </p>
    </div>
  );
}
