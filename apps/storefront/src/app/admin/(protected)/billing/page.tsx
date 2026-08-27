import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { aggregateTenantAiUsage, type AiRawUsageRow } from '@/lib/ai/productUsage';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function daysRemaining(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const INCLUDED_MODULES = [
  'Boutique',
  'Événementiel',
  'Carte digitale',
  'Intelligence IA',
] as const;

export default async function BillingPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const supabase = createServiceClient();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(`
      id, name,
      subscription_status, subscription_paid_until,
      stripe_payment_link,
      bank_iban, bank_beneficiary, bank_bic
    `)
    .eq('slug', slug)
    .single();

  if (error || !tenant) redirect('/admin');

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data: aiUsageRows } = await supabase
    .from('ai_usage_monthly_by_tenant')
    .select('endpoint, total_calls')
    .eq('tenant_id', tenant.id)
    .gte('month', monthStart);

  const aiUsage = aggregateTenantAiUsage((aiUsageRows ?? []) as AiRawUsageRow[]);
  const aiUsageTotal = aiUsage.reduce((sum, row) => sum + row.usageCount, 0);

  const isActive = tenant.subscription_status === 'active';
  const days = daysRemaining(tenant.subscription_paid_until);
  const isWarning = days !== null && days <= 7 && isActive;
  const isExpired = !isActive || (days !== null && days < 0);

  const transferReference = `Abonnement Lepefy Food Platform - ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900 dark:text-white">Abonnement</h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        Plateforme Lepefy Food · Abonnement actif
      </p>

      {isExpired && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <span className="mt-0.5 text-lg leading-none">⚠️</span>
          <div>
            <strong>Abonnement expiré.</strong> Les services Lepefy de votre établissement sont actuellement suspendus.
            Renouvelez votre abonnement pour rétablir le service.
          </div>
        </div>
      )}

      {isWarning && !isExpired && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="mt-0.5 text-lg leading-none">🔔</span>
          <div>
            <strong>Renouvellement dans {days} jours</strong> ({formatDate(tenant.subscription_paid_until)}).
            Procédez au paiement pour éviter toute interruption de service.
          </div>
        </div>
      )}

      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-start justify-between gap-4 border-b border-gray-100 pb-4 dark:border-gray-800">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{tenant.name}</p>
            <p className="mt-0.5 text-xs text-gray-400">Lepefy Food Platform · 89,00 €/mois</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              isExpired
                ? 'bg-red-100 text-red-700'
                : isWarning
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-green-100 text-green-700'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isExpired ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-green-500'}`} />
            {isExpired ? 'Expiré' : isWarning ? `Expire dans ${days} jours` : 'Actif'}
          </span>
        </div>

        <div className="mb-4 border-b border-gray-100 pb-4 dark:border-gray-800">
          <p className="mb-2 text-xs font-medium text-gray-500">Modules inclus</p>
          <div className="flex flex-wrap gap-2">
            {INCLUDED_MODULES.map((module) => (
              <span
                key={module}
                className="inline-flex rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300"
              >
                {module}
              </span>
            ))}
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Montant mensuel</dt>
            <dd className="font-medium text-gray-900 dark:text-white">89,00 € (HT)</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Abonnement actif jusqu&apos;au</dt>
            <dd className={`font-medium ${isExpired ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
              {formatDate(tenant.subscription_paid_until)}
            </dd>
          </div>
        </dl>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Modes de paiement</h2>
      <div className="space-y-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">💳 Carte bancaire</p>
            <p className="mt-0.5 text-xs text-gray-400">Paiement immédiat via Stripe · Sécurisé et tracé</p>
          </div>
          <p className="mb-4 text-xs text-gray-400">
            Le paiement est confirmé automatiquement. Votre abonnement se renouvelle instantanément.
          </p>
          {tenant.stripe_payment_link ? (
            <a
              href={tenant.stripe_payment_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--admin-primary)' }}
            >
              Payer par carte — 89,00 €
            </a>
          ) : (
            <p className="text-xs italic text-gray-400">Lien non encore configuré. Contactez Lepefy Labs.</p>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">🏦 Virement bancaire</p>
              <p className="mt-0.5 text-xs text-gray-400">Zéro commission · 1–2 jours ouvrés</p>
            </div>
            <span className="inline-flex whitespace-nowrap rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
              Recommandé
            </span>
          </div>
          <p className="mb-4 text-xs text-gray-400">
            Effectuez le virement avec les coordonnées ci-dessous. Lepefy Labs mettra à jour votre abonnement sous 1–2 jours ouvrés après réception du paiement.
          </p>
          {tenant.bank_iban ? (
            <dl className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-950">
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500">Bénéficiaire</dt>
                <dd className="text-right font-medium text-gray-900 dark:text-white">{tenant.bank_beneficiary ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500">IBAN</dt>
                <dd className="text-right font-mono font-medium text-gray-900 dark:text-white">{tenant.bank_iban}</dd>
              </div>
              {tenant.bank_bic && (
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-gray-500">BIC / SWIFT</dt>
                  <dd className="text-right font-mono font-medium text-gray-900 dark:text-white">{tenant.bank_bic}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 dark:border-gray-800">
                <dt className="shrink-0 text-gray-500">Montant</dt>
                <dd className="font-semibold text-gray-900 dark:text-white">89,00 €</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500">Référence</dt>
                <dd className="text-right text-xs text-gray-700 dark:text-gray-300">{transferReference}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs italic text-gray-400">
              Coordonnées bancaires non encore configurées.{' '}
              <a href="mailto:support@lepefy.com" className="underline">Contactez Lepefy Labs</a>.
            </p>
          )}
        </div>
      </div>

      <section className="mt-8 rounded-2xl border border-violet-100 bg-violet-50/60 p-5 dark:border-violet-900/50 dark:bg-violet-950/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Intelligence artificielle</h2>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-violet-700 shadow-sm dark:bg-violet-950/60 dark:text-violet-300">Inclus</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{aiUsageTotal}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">utilisations ce mois · aucun coût supplémentaire actuellement</p>
          </div>
          <Link
            href="/admin/ai-usage"
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-900/50"
          >
            Voir l’utilisation IA
          </Link>
        </div>
      </section>

      {isExpired && (
        <p className="mt-4 text-xs text-gray-400">
          Vos données (produits, commandes, clients) sont conservées 30 jours après l&apos;expiration.
          Renouvelez avant cette date pour ne rien perdre.
        </p>
      )}

      <div className="mt-8 border-t border-gray-100 pt-6 dark:border-gray-800">
        <p className="text-xs text-gray-400">
          Pour toute question sur la facturation, contactez{' '}
          <a href="mailto:support@lepefy.com" className="underline">support@lepefy.com</a>{' '}
          ou écrivez sur WhatsApp au numéro Lepefy Labs.
        </p>
      </div>
    </div>
  );
}
