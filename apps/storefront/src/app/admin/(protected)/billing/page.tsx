import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IconBrandPaypal, IconBuildingBank, IconCreditCard, IconChevronDown } from '@tabler/icons-react';
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
import InlineAlert from '../../_components/ui/InlineAlert';
import { ButtonAnchor } from '../../_components/ui/Button';
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

  const mailSupport = <a href={`mailto:${billing.supportEmail}`} className="font-semibold underline">Contactez Lepefy</a>;
  const needsPayment = state.kind === 'suspended' || state.kind === 'overdue' || state.kind === 'due_soon';
  const paidUntilLabel = subscription.paid_until ? formatBillingDate(subscription.paid_until) : null;

  return (
    <div className="max-w-3xl">
      <AdminPageHeader title="Abonnement" description={`${billing.planName} · ${price} HT / mois`} />

      {state.kind === 'suspended' && (
        <InlineAlert tone="danger" className="mb-4" title={`Abonnement suspendu${state.suspendedBy === 'automatic' ? ' automatiquement' : ''}`}>
          Boutique, événementiel, carte digitale, paiements en ligne, Nala et avis sont hors ligne. Un paiement par carte rétablit le service dès sa confirmation par Stripe ;
          un paiement PayPal ou un virement le rétablit après vérification par Lepefy.
          {serviceState.suspensionReason && <span className="mt-1 block text-xs">Motif : {serviceState.suspensionReason}</span>}
        </InlineAlert>
      )}
      {state.kind === 'overdue' && (
        <InlineAlert tone="warning" className="mb-4" title={`Échéance dépassée depuis ${plural(state.daysOverdue, 'jour')} (${formatBillingDate(subscription.paid_until)})`}>
          {state.autoSuspendAt
            ? <>Sans paiement, le service sera suspendu le <strong>{formatBillingDate(state.autoSuspendAt)}</strong>.</>
            : <>Votre service reste actif pour l&apos;instant : réglez l&apos;abonnement pour éviter une suspension.</>}
        </InlineAlert>
      )}
      {state.kind === 'due_soon' && state.daysLeft !== null && (
        <InlineAlert tone="warning" className="mb-4" title={`${state.daysLeft === 0 ? 'Échéance aujourd’hui' : `Échéance dans ${plural(state.daysLeft, 'jour')}`} (${formatBillingDate(subscription.paid_until)})`}>
          Réglez l&apos;abonnement pour éviter toute interruption.
        </InlineAlert>
      )}
      {serviceState.suspendedModules.length > 0 && (
        <InlineAlert tone="neutral" className="mb-4">
          Module{serviceState.suspendedModules.length > 1 ? 's' : ''} suspendu{serviceState.suspendedModules.length > 1 ? 's' : ''} par Lepefy :{' '}
          {serviceState.suspendedModules.map((module) => MODULE_LABELS[module]).join(', ')}.
        </InlineAlert>
      )}

      <section aria-labelledby="pay-title" className="mb-5 rounded-2xl border border-a-border bg-a-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="pay-title" className="text-sm font-semibold text-a-text-2">{needsPayment ? 'Régler l’abonnement' : 'Prochain paiement'}</h2>
            <p className="mt-1 text-3xl font-bold tabular-nums text-a-text">{price} <span className="text-sm font-medium text-a-text-3">HT / mois</span></p>
          </div>
          <Badge tone={badgeTone} dot className="shrink-0">{STATE_LABEL[state.kind]}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-xl bg-a-surface-2 p-3">
            <dt className="text-xs text-a-text-3">Payé jusqu&apos;au</dt>
            <dd className="mt-0.5 font-semibold text-a-text">{paidUntilLabel ?? 'Échéance non définie'}</dd>
          </div>
          <div className="rounded-xl bg-a-surface-2 p-3">
            <dt className="text-xs text-a-text-3">Ce paiement couvre</dt>
            <dd className="mt-0.5 font-semibold capitalize text-a-text">{coveredLabel}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-a-text-3">Un paiement prolonge l&apos;abonnement jusqu&apos;à la fin de ce mois.</p>

        <div className="mt-5 space-y-3">
          <div className="rounded-2xl border-2 border-a-brand bg-a-surface p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-a-brand-soft text-a-brand-fg"><IconCreditCard size={22} stroke={1.8} aria-hidden="true" /></span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-a-text">Carte bancaire</h3>
                <p className="mt-0.5 text-xs text-a-text-3">Paiement Stripe sécurisé. L&apos;échéance est prolongée automatiquement dès que Stripe confirme le paiement.</p>
              </div>
            </div>
            {billing.stripePaymentLink ? (
              <ButtonAnchor variant="primary" href={billing.stripePaymentLink} target="_blank" rel="noopener noreferrer" className="mt-4 min-h-12 w-full text-base">
                Payer par carte · {price}
              </ButtonAnchor>
            ) : (
              <InlineAlert tone="neutral" className="mt-4" title="Paiement par carte pas encore disponible">
                Le lien de paiement n&apos;est pas encore configuré. Utilisez un autre moyen ci-dessous ou {mailSupport}.
              </InlineAlert>
            )}
          </div>

          {paypalLink && (
            <div className="rounded-2xl border border-a-border p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-a-surface-2 text-a-text-2"><IconBrandPaypal size={22} stroke={1.8} aria-hidden="true" /></span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-a-text">PayPal</h3>
                  <p className="mt-0.5 text-xs text-a-text-3">L&apos;échéance est prolongée par Lepefy après vérification du paiement.</p>
                </div>
              </div>
              <ButtonAnchor variant="secondary" href={paypalLink} target="_blank" rel="noopener noreferrer" className="mt-4 min-h-12 w-full text-base">
                Payer avec PayPal · {price}
              </ButtonAnchor>
              <div className="mt-3 rounded-xl bg-a-surface-2 p-3">
                <CopyableValue stacked label="Note à indiquer dans PayPal" value={reference} />
              </div>
            </div>
          )}

          <details className="group rounded-2xl border border-a-border">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus [&::-webkit-details-marker]:hidden">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-a-surface-2 text-a-text-2"><IconBuildingBank size={22} stroke={1.8} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-a-text">Virement bancaire</span>
                <span className="block text-xs text-a-text-3">Sans commission · <span className="font-semibold text-a-brand-fg">Voir les coordonnées bancaires</span></span>
              </span>
              <IconChevronDown size={18} aria-hidden="true" className="shrink-0 text-a-text-3 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-a-border p-4">
              {billing.bankIban ? (
                <div className="space-y-3 rounded-xl bg-a-surface-2 p-3">
                  {billing.bankBeneficiary && <CopyableValue stacked label="Bénéficiaire" value={billing.bankBeneficiary} />}
                  <CopyableValue stacked label="IBAN" value={billing.bankIban} />
                  {billing.bankBic && <CopyableValue stacked label="BIC" value={billing.bankBic} />}
                  <CopyableValue stacked label="Montant" value={amountPlain} />
                  <CopyableValue stacked label="Référence" value={reference} />
                  <p className="text-xs text-a-text-3">
                    Indiquez exactement cette référence : elle identifie votre établissement et le mois payé.
                    Lepefy prolonge l&apos;échéance à réception du virement (1 à 2 jours ouvrés).
                  </p>
                </div>
              ) : (
                <InlineAlert tone="neutral" title="Coordonnées bancaires pas encore disponibles">
                  Elles ne sont pas encore configurées. {mailSupport}.
                </InlineAlert>
              )}
            </div>
          </details>
        </div>
      </section>

      <section aria-labelledby="plan-title" className="mb-5 rounded-2xl border border-a-border bg-a-surface p-4 sm:p-5">
        <h2 id="plan-title" className="text-sm font-semibold text-a-text-2">Votre abonnement</h2>
        <p className="mt-1 text-sm text-a-text">{tenant.name} · {billing.planName}</p>
        <p className="mb-2 mt-4 text-xs font-medium text-a-text-3">Modules inclus ({billing.features.length})</p>
        <div className="flex flex-wrap gap-2">
          {billing.features.map((feature) => (
            <span key={feature.key} className="inline-flex rounded-full border border-a-border bg-a-brand-soft px-2.5 py-1 text-xs font-medium text-a-brand-fg">
              {feature.label}
            </span>
          ))}
        </div>
      </section>

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
