import Link from 'next/link';
import { IconArrowLeft, IconArrowUpRight } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import {
  loadFunnelSessions,
  parseFunnelRange,
  recoverableCarts,
  RECOVERY_WINDOW_DAYS,
  sessionValue,
  summarizeFunnel,
  type FunnelRange,
} from '@/lib/admin/checkoutFunnel';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const money = (value: number, currency: string) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
const day = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const CARD = 'rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm sm:p-5';

function RangeTabs({ active }: { active: FunnelRange }) {
  return (
    <nav aria-label="Période" className="inline-flex rounded-xl border border-a-border bg-a-surface p-1">
      {[7, 30, 90].map((range) => (
        <Link key={range} href={`/admin/checkout-funnel?range=${range}`} aria-current={active === range ? 'page' : undefined}
          className={`rounded-lg px-3 py-2 text-xs font-semibold ${active === range ? 'bg-a-brand text-a-on-brand' : 'text-a-text-3 hover:bg-a-surface-2'}`}>
          {range} jours
        </Link>
      ))}
    </nav>
  );
}

export default async function CheckoutFunnelPage({ searchParams }: { searchParams?: { range?: string | string[] } }) {
  const range = parseFunnelRange(searchParams?.range);
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const currency = tenant.currency ?? 'EUR';

  let sessions;
  try {
    sessions = await loadFunnelSessions(createServiceClient(), tenant.id, range);
  } catch (error) {
    console.error('[checkout-funnel] load failed', tenant.id, error);
    return (
      <div className="mx-auto w-full max-w-6xl pb-10">
        <AdminPageHeader title="Funnel checkout" description="Statistiques momentanément indisponibles. Réessayez dans quelques minutes." />
      </div>
    );
  }

  const summary = summarizeFunnel(sessions);
  const toRecover = recoverableCarts(sessions);
  const toVerify = sessions.filter((session) => session.status === 'awaiting_verification');

  const steps = [
    { label: 'Paiements commencés', value: summary.started, detail: 'Clients arrivés au paiement' },
    { label: 'Commandes', value: summary.completed, detail: summary.conversionRate === null ? 'Aucun paiement terminé' : `${summary.conversionRate.toLocaleString('fr-FR')} % des paiements terminés`, tone: 'text-tone-success-fg' },
    { label: 'En cours', value: summary.inProgress, detail: `${summary.open} à finaliser · ${summary.awaitingVerification} à vérifier`, tone: 'text-tone-warning-fg' },
    { label: 'Perdus', value: summary.expired + summary.cancelled, detail: `${summary.expired} expirés (24 h) · ${summary.cancelled} annulés`, tone: 'text-tone-danger-fg' },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <Link href="/admin" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-a-text-3 hover:text-a-text">
        <IconArrowLeft size={16} /> Commandes
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <AdminPageHeader
          title="Funnel checkout"
          description="Combien de clients arrivés au paiement finissent par commander, ce qui est encore récupérable et ce qui a été perdu (boutique en ligne, hors commandes test)."
        />
        <RangeTabs active={range} />
      </div>

      <section className={CARD}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.label} className="rounded-xl bg-a-surface-2 p-3">
              <p className="text-xs font-medium text-a-text-3">{step.label}</p>
              <p className={`mt-1 text-2xl font-bold ${step.tone ?? 'text-a-text'}`}>{step.value}</p>
              <p className="text-xs text-a-text-3">{step.detail}</p>
            </div>
          ))}
        </div>
        <dl className="mt-4 grid gap-3 border-t border-a-border pt-3 text-sm sm:grid-cols-3">
          <div><dt className="text-a-text-3">Valeur commandée</dt><dd className="font-semibold text-tone-success-fg">{money(summary.value.converted, currency)}</dd></div>
          <div><dt className="text-a-text-3">Valeur en attente</dt><dd className="font-semibold text-tone-warning-fg">{money(summary.value.pending, currency)}</dd></div>
          <div><dt className="text-a-text-3">Valeur perdue</dt><dd className="font-semibold text-tone-danger-fg">{money(summary.value.lost, currency)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-a-text-3">
          Valeur = articles + livraison − réduction parrainage. Le taux de conversion ignore les paiements encore en cours.
          {summary.resumed > 0 && ` Reprises : ${summary.resumed} panier${summary.resumed > 1 ? 's' : ''} rouvert${summary.resumed > 1 ? 's' : ''}, dont ${summary.recovered} transformé${summary.recovered > 1 ? 's' : ''} en commande.`}
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={CARD}>
          <h2 className="font-semibold text-a-text">Paiements externes à vérifier ({toVerify.length})</h2>
          <p className="mt-1 text-xs text-a-text-3">Le client a payé hors Stripe (PayPal, Revolut…) : confirmez la réception pour créer la commande.</p>
          {toVerify.length === 0 ? <p className="mt-4 text-sm text-a-text-3">Rien à vérifier.</p> : (
            <ul className="mt-3 divide-y divide-a-border">
              {toVerify.map((session) => (
                <li key={session.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{session.full_name || session.email || 'Client'} · {money(sessionValue(session), currency)}</span>
                  <Link href={`/admin/paiements-en-attente/${session.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-a-brand-fg hover:underline">Vérifier <IconArrowUpRight size={14} /></Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={CARD}>
          <h2 className="font-semibold text-a-text">Paniers à relancer ({toRecover.length})</h2>
          <p className="mt-1 text-xs text-a-text-3">Paiements non finalisés des {RECOVERY_WINDOW_DAYS} derniers jours, du plus gros panier au plus petit. La fiche permet d’envoyer une relance.</p>
          {toRecover.length === 0 ? <p className="mt-4 text-sm text-a-text-3">Aucun panier à relancer.</p> : (
            <ul className="mt-3 divide-y divide-a-border">
              {toRecover.map((cart) => (
                <li key={cart.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-a-text">{cart.customer}</span>
                    <span className="text-xs text-a-text-3">{day(cart.createdAt)} · {cart.status === 'open' ? 'en cours' : 'expiré'}</span>
                  </span>
                  <strong className="shrink-0">{money(cart.value, currency)}</strong>
                  <Link href={`/admin/paiements-en-attente/${cart.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-a-brand-fg hover:underline">Fiche <IconArrowUpRight size={14} /></Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="text-xs text-a-text-3">
        Un paiement « à finaliser » n’est pas une commande et expire après 24 h. Aucun stock n’est réservé avant le paiement confirmé.
        Les commandes saisies par l’équipe (WhatsApp, téléphone…) ne sont pas comptées ici.
      </p>
    </div>
  );
}
