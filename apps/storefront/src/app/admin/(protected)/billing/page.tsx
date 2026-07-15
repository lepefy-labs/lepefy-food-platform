import { createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { AiUsageMonthlyByTenant } from '@lepefy/types';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('it-IT', {
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

function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

export default async function BillingPage() {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
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

  const now             = new Date();
  const monthStart      = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data: aiUsageRows } = await supabase
    .from('ai_usage_monthly_by_tenant')
    .select('tenant_id, month, provider, endpoint, total_calls, total_cost_usd')
    .eq('tenant_id', tenant.id)
    .gte('month', monthStart);

  const aiUsage      = (aiUsageRows ?? []) as AiUsageMonthlyByTenant[];
  const aiUsageTotal = aiUsage.reduce((sum, row) => sum + Number(row.total_cost_usd), 0);

  const isActive  = tenant.subscription_status === 'active';
  const days      = daysRemaining(tenant.subscription_paid_until);
  const isWarning = days !== null && days <= 7 && isActive;
  const isExpired = !isActive || (days !== null && days < 0);

  // Causale bonifico standard
  const bonificoRef = `Abbonamento Lepefy Food Platform - ${new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}`;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Abonnement</h1>
      <p className="text-sm text-gray-500 mb-6">
        Plateforme Lepefy Food · Plan Boutique
      </p>

      {/* Banner stato */}
      {isExpired && (
        <div className="mb-5 flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm">
          <span className="text-lg leading-none mt-0.5">⚠️</span>
          <div>
            <strong>Abonnement expiré.</strong> Votre boutique en ligne est actuellement suspendue.
            Renouvelez votre abonnement pour rétablir le service.
          </div>
        </div>
      )}
      {isWarning && !isExpired && (
        <div className="mb-5 flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
          <span className="text-lg leading-none mt-0.5">🔔</span>
          <div>
            <strong>Renouvellement dans {days} jours</strong> ({formatDate(tenant.subscription_paid_until)}).
            Procédez au paiement pour éviter toute interruption de service.
          </div>
        </div>
      )}

      {/* Card stato abbonamento */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-5">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-900 text-sm">{tenant.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">Plan Boutique · 89,00 €/mois</p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full ${
              isExpired
                ? 'bg-red-100 text-red-700'
                : isWarning
                ? 'bg-amber-100 text-amber-700'
                : 'bg-green-100 text-green-700'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              isExpired ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-green-500'
            }`} />
            {isExpired ? 'Expiré' : isWarning ? `Expire dans ${days} jours` : 'Actif'}
          </span>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Montant mensuel</dt>
            <dd className="font-medium text-gray-900">89,00 € (HT)</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Abonnement actif jusqu&apos;au</dt>
            <dd className={`font-medium ${isExpired ? 'text-red-600' : 'text-gray-900'}`}>
              {formatDate(tenant.subscription_paid_until)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Metodi di pagamento */}
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Modes de paiement</h2>
      <div className="space-y-3">

        {/* Opzione 1 — Stripe */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">💳 Carte bancaire</p>
              <p className="text-xs text-gray-400 mt-0.5">Paiement immédiat via Stripe · Sécurisé et tracé</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Le paiement est confirmé automatiquement. Votre abonnement se renouvelle instantanément.
          </p>
          {tenant.stripe_payment_link ? (
            <a
              href={tenant.stripe_payment_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Payer par carte — 89,00 €
            </a>
          ) : (
            <p className="text-xs text-gray-400 italic">Lien non encore configuré. Contactez Lepefy Labs.</p>
          )}
        </div>

        {/* Opzione 2 — Bonifico */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">🏦 Virement bancaire</p>
              <p className="text-xs text-gray-400 mt-0.5">Zéro commission · 1–2 jours ouvrés</p>
            </div>
            <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
              Recommandé
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Effectuez le virement avec les coordonnées ci-dessous. Lepefy Labs mettra à jour votre
            abonnement sous 1–2 jours ouvrés après réception du paiement.
          </p>
          {tenant.bank_iban ? (
            <dl className="space-y-2 text-sm bg-gray-50 rounded-xl p-4">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500 shrink-0">Bénéficiaire</dt>
                <dd className="font-medium text-gray-900 text-right">{tenant.bank_beneficiary ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500 shrink-0">IBAN</dt>
                <dd className="font-mono font-medium text-gray-900 text-right">{tenant.bank_iban}</dd>
              </div>
              {tenant.bank_bic && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500 shrink-0">BIC / SWIFT</dt>
                  <dd className="font-mono font-medium text-gray-900 text-right">{tenant.bank_bic}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 pt-2 border-t border-gray-200">
                <dt className="text-gray-500 shrink-0">Montant</dt>
                <dd className="font-semibold text-gray-900">89,00 €</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500 shrink-0">Référence</dt>
                <dd className="text-gray-700 text-right text-xs">{bonificoRef}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-gray-400 italic">
              Coordonnées bancaires non encore configurées.{' '}
              <a href="mailto:support@lepefy.com" className="underline">Contactez Lepefy Labs</a>.
            </p>
          )}
        </div>
      </div>

      {/* Utilisation IA */}
      <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-3">Utilisation IA</h2>
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        {aiUsage.length === 0 ? (
          <p className="text-xs text-gray-400">
            Aucune utilisation IA enregistrée ce mois-ci.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="pb-2 font-medium">Provider</th>
                    <th className="pb-2 font-medium">Endpoint</th>
                    <th className="pb-2 font-medium text-right">Appels</th>
                    <th className="pb-2 font-medium text-right">Coût (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {aiUsage.map((row) => (
                    <tr key={`${row.provider}-${row.endpoint}`} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 text-gray-700">{row.provider}</td>
                      <td className="py-2 text-gray-700 font-mono text-xs">{row.endpoint}</td>
                      <td className="py-2 text-right text-gray-900">{row.total_calls}</td>
                      <td className="py-2 text-right text-gray-900">{formatUsd(Number(row.total_cost_usd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100">
              <span className="text-sm font-medium text-gray-700">Total du mois</span>
              <span className="text-base font-semibold text-gray-900">{formatUsd(aiUsageTotal)}</span>
            </div>
          </>
        )}
      </div>

      {/* Info conservazione dati */}
      {isExpired && (
        <p className="mt-4 text-xs text-gray-400">
          Vos données (produits, commandes, clients) sont conservées 30 jours après l&apos;expiration.
          Renouvelez avant cette date pour ne rien perdre.
        </p>
      )}

      {/* Contatto assistenza */}
      <div className="mt-8 pt-6 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          Pour toute question sur la facturation, contactez{' '}
          <a href="mailto:support@lepefy.com" className="underline">support@lepefy.com</a>{' '}
          ou écrivez sur WhatsApp au numéro Lepefy Labs.
        </p>
      </div>
    </div>
  );
}
