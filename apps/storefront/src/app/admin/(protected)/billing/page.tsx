import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { aggregateTenantAiUsage, type AiRawUsageRow } from '@/lib/ai/productUsage';
import { formatPlanPrice, getTenantBillingSnapshot } from '@/lib/admin/platformBilling';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysRemaining(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
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

  const [billing, aiUsageResult] = await Promise.all([
    getTenantBillingSnapshot(tenant),
    supabase
      .from('ai_usage_monthly_by_tenant')
      .select('endpoint, total_calls')
      .eq('tenant_id', tenant.id)
      .gte('month', new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()),
  ]);

  const aiUsage = aggregateTenantAiUsage((aiUsageResult.data ?? []) as AiRawUsageRow[]);
  const aiUsageTotal = aiUsage.reduce((sum, row) => sum + row.usageCount, 0);
  const price = formatPlanPrice(billing.monthlyPriceCents, billing.currency);
  const isActive = billing.status === 'active';
  const days = daysRemaining(billing.paidUntil);
  const isWarning = days !== null && days <= 7 && days >= 0 && isActive;
  const isExpired = !isActive || (days !== null && days < 0);
  const transferReference = `Abonnement ${billing.planName} - ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900 dark:text-white">Abonnement</h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">Plateforme Lepefy Food · Abonnement actif</p>

      {isExpired && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <strong>Abonnement expiré.</strong> Les services Lepefy de votre établissement sont actuellement suspendus. Renouvelez votre abonnement pour rétablir le service.
        </div>
      )}

      {isWarning && !isExpired && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Renouvellement dans {days} jours</strong> ({formatDate(billing.paidUntil)}). Procédez au paiement pour éviter toute interruption de service.
        </div>
      )}

      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-start justify-between gap-4 border-b border-gray-100 pb-4 dark:border-gray-800">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{tenant.name}</p>
            <p className="mt-0.5 text-xs text-gray-400">{billing.planName} · {price}/mois</p>
          </div>
          <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-medium ${isExpired ? 'bg-red-100 text-red-700' : isWarning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
            {isExpired ? 'Expiré' : isWarning ? `Expire dans ${days} jours` : 'Actif'}
          </span>
        </div>

        <div className="mb-4 border-b border-gray-100 pb-4 dark:border-gray-800">
          <p className="mb-2 text-xs font-medium text-gray-500">Modules inclus</p>
          <div className="flex flex-wrap gap-2">
            {billing.features.map((feature) => (
              <span key={feature.key} className="inline-flex rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300">
                {feature.label}
              </span>
            ))}
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between"><dt className="text-gray-500">Plan</dt><dd className="font-medium text-gray-900 dark:text-white">{billing.planName}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Montant mensuel</dt><dd className="font-medium text-gray-900 dark:text-white">{price} (HT)</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Abonnement actif jusqu&apos;au</dt><dd className={`font-medium ${isExpired ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{formatDate(billing.paidUntil)}</dd></div>
        </dl>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Modes de paiement</h2>
      <div className="space-y-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">💳 Carte bancaire</p>
          <p className="mb-4 mt-1 text-xs text-gray-400">Paiement immédiat via Stripe · Sécurisé et tracé</p>
          {billing.stripePaymentLink ? (
            <a href={billing.stripePaymentLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: 'var(--admin-primary)' }}>
              Payer par carte — {price}
            </a>
          ) : (
            <p className="text-xs italic text-gray-400">Lien non encore configuré. Contactez Lepefy Labs.</p>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">🏦 Virement bancaire</p>
          <p className="mb-4 mt-1 text-xs text-gray-400">Zéro commission · 1–2 jours ouvrés</p>
          {billing.bankIban ? (
            <dl className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-950">
              <div className="flex justify-between gap-4"><dt className="text-gray-500">Bénéficiaire</dt><dd className="text-right font-medium">{billing.bankBeneficiary ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-500">IBAN</dt><dd className="text-right font-mono font-medium">{billing.bankIban}</dd></div>
              {billing.bankBic && <div className="flex justify-between gap-4"><dt className="text-gray-500">BIC / SWIFT</dt><dd className="text-right font-mono font-medium">{billing.bankBic}</dd></div>}
              <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 dark:border-gray-800"><dt className="text-gray-500">Montant</dt><dd className="font-semibold">{price}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-500">Référence</dt><dd className="text-right text-xs">{transferReference}</dd></div>
            </dl>
          ) : (
            <p className="text-xs italic text-gray-400">Coordonnées bancaires non encore configurées. <a href={`mailto:${billing.supportEmail}`} className="underline">Contactez Lepefy Labs</a>.</p>
          )}
        </div>
      </div>

      <section className="mt-8 rounded-2xl border border-violet-100 bg-violet-50/60 p-5 dark:border-violet-900/50 dark:bg-violet-950/20">
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

      <div className="mt-8 border-t border-gray-100 pt-6 dark:border-gray-800">
        <p className="text-xs text-gray-400">Pour toute question sur la facturation, contactez <a href={`mailto:${billing.supportEmail}`} className="underline">{billing.supportEmail}</a>.</p>
      </div>
    </div>
  );
}
