import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { redirect } from 'next/navigation';

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

export default async function BillingPage() {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const supabase = createServiceClient();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, subscription_status, subscription_paid_until, stripe_payment_link')
    .eq('slug', slug)
    .single();

  if (error || !tenant) redirect('/admin');

  const isActive  = tenant.subscription_status === 'active';
  const days      = daysRemaining(tenant.subscription_paid_until);
  const isWarning = days !== null && days <= 7 && isActive;
  const isExpired = !isActive || (days !== null && days < 0);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Abbonamento</h1>
      <p className="text-sm text-gray-500 mb-6">
        Piattaforma Lepefy Food · Piano Boutique
      </p>

      {/* Banner stato */}
      {isExpired && (
        <div className="mb-5 flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm">
          <span className="text-lg leading-none mt-0.5">⚠️</span>
          <div>
            <strong>Abbonamento scaduto.</strong> Il tuo negozio online è attualmente sospeso.
            Rinnova l&apos;abbonamento per ripristinare il servizio.
          </div>
        </div>
      )}
      {isWarning && !isExpired && (
        <div className="mb-5 flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
          <span className="text-lg leading-none mt-0.5">🔔</span>
          <div>
            <strong>Rinnovo in scadenza tra {days} giorni</strong> ({formatDate(tenant.subscription_paid_until)}).
            Procedi al pagamento per evitare interruzioni del servizio.
          </div>
        </div>
      )}

      {/* Card stato abbonamento */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-900 text-sm">{tenant.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">Piano Boutique · 89,00 €/mese</p>
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
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isExpired ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-green-500'
              }`}
            />
            {isExpired ? 'Scaduto' : isWarning ? `Scade tra ${days} giorni` : 'Attivo'}
          </span>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Importo mensile</dt>
            <dd className="font-medium text-gray-900">89,00 € (IVA esclusa)</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Abbonamento attivo fino al</dt>
            <dd className={`font-medium ${isExpired ? 'text-red-600' : 'text-gray-900'}`}>
              {formatDate(tenant.subscription_paid_until)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Metodo di rinnovo</dt>
            <dd className="text-gray-900">Link pagamento mensile</dd>
          </div>
        </dl>
      </div>

      {/* Pulsante pagamento */}
      {tenant.stripe_payment_link ? (
        <a
          href={tenant.stripe_payment_link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          💳 Rinnova abbonamento — 89,00 €
        </a>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500">
          Link di pagamento non ancora configurato.{' '}
          <a href="mailto:support@lepefy.com" className="underline">
            Contatta Lepefy Labs
          </a>{' '}
          per ricevere il link mensile.
        </div>
      )}

      {/* Info conservazione dati */}
      {isExpired && (
        <p className="mt-4 text-xs text-gray-400">
          I tuoi dati (prodotti, ordini, clienti) sono conservati per 30 giorni dalla scadenza.
          Rinnova entro quella data per non perdere nulla.
        </p>
      )}

      {/* Contatto assistenza */}
      <div className="mt-8 pt-6 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          Per domande sulla fatturazione contatta{' '}
          <a href="mailto:support@lepefy.com" className="underline">
            support@lepefy.com
          </a>{' '}
          oppure scrivi su WhatsApp al numero Lepefy Labs.
        </p>
      </div>
    </div>
  );
}
