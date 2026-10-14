'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconBrandStripe, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import Badge from '../../../_components/ui/Badge';
import { formatMoney } from '@/lib/admin/format';
import type { StripeIntentView } from '@/lib/payments/cardCartOutcome';

type Result =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'missing'; reason: 'no_intent' | 'not_found' }
  | { state: 'ok'; view: StripeIntentView; dashboardUrl: string };

function dateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(value));
}

/**
 * « Paiement Stripe » de la fiche panier carte : lecture seule, à la demande
 * (GET /api/admin/checkout-sessions/[id]/stripe). Ne montre que statut,
 * motif, réseau et 4 derniers chiffres ; aucune action sur le paiement.
 */
export default function StripePaymentPanel({ sessionId }: { sessionId: string }) {
  const [result, setResult] = useState<Result>({ state: 'loading' });

  const load = useCallback(async () => {
    setResult({ state: 'loading' });
    try {
      const response = await fetch(`/api/admin/checkout-sessions/${sessionId}/stripe`, { cache: 'no-store' });
      const body = await response.json().catch(() => null) as
        | { found: true; view: StripeIntentView; dashboardUrl: string }
        | { found: false; reason: 'no_intent' | 'not_found' }
        | { error?: string } | null;
      if (!response.ok || !body || 'error' in body) {
        setResult({ state: 'error', message: (body && 'error' in body && body.error) || 'Lecture Stripe impossible.' });
      } else if ('found' in body && body.found) {
        setResult({ state: 'ok', view: body.view, dashboardUrl: body.dashboardUrl });
      } else if ('found' in body) {
        setResult({ state: 'missing', reason: body.reason });
      }
    } catch {
      setResult({ state: 'error', message: 'Lecture Stripe impossible. Vérifiez votre connexion.' });
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm" aria-labelledby="stripe-panel-title" aria-busy={result.state === 'loading'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="stripe-panel-title" className="flex items-center gap-2 font-bold text-a-text">
          <IconBrandStripe size={18} aria-hidden="true" /> Paiement Stripe
          {result.state === 'ok' && <Badge tone={result.view.tone} dot>{result.view.statusLabel}</Badge>}
        </h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} disabled={result.state === 'loading'}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-a-border bg-a-surface px-3 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus disabled:opacity-60">
            <IconRefresh size={16} aria-hidden="true" /> Actualiser
          </button>
          {result.state === 'ok' && (
            <a href={result.dashboardUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-a-border bg-a-surface px-3 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus">
              Ouvrir dans Stripe <IconExternalLink size={16} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      {result.state === 'loading' && <p className="mt-3 text-sm text-a-text-3" role="status">Lecture chez Stripe…</p>}
      {result.state === 'error' && <p className="mt-3 text-sm text-tone-danger-fg" role="alert">{result.message}</p>}
      {result.state === 'missing' && (
        <p className="mt-3 text-sm text-a-text-3">
          {result.reason === 'no_intent'
            ? 'Aucun paiement n’a été créé chez Stripe : le client n’a pas cliqué sur « Payer ».'
            : 'Ce paiement est introuvable chez Stripe avec la clé de cette boutique.'}
        </p>
      )}
      {result.state === 'ok' && (
        <div className="mt-3 grid gap-3">
          <p className="text-sm leading-6 text-a-text-2">{result.view.explanation}</p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block"><dt className="text-a-text-3">Montant</dt><dd className="font-semibold text-a-text">{formatMoney(result.view.amount, result.view.currency)}</dd></div>
            <div className="flex justify-between gap-3 sm:block"><dt className="text-a-text-3">Créé chez Stripe</dt><dd className="font-semibold text-a-text">{dateTime(result.view.createdAt)}</dd></div>
            <div className="flex justify-between gap-3 sm:block"><dt className="text-a-text-3">Dernière tentative</dt><dd className="font-semibold text-a-text">
              {result.view.lastAttempt
                ? `${dateTime(result.view.lastAttempt.at)} · ${result.view.lastAttempt.result}${result.view.lastAttempt.reason ? ` · ${result.view.lastAttempt.reason}` : ''}`
                : 'Aucune'}
            </dd></div>
            <div className="flex justify-between gap-3 sm:block"><dt className="text-a-text-3">Carte</dt><dd className="font-semibold text-a-text">{result.view.card ?? '—'}</dd></div>
          </dl>
          <p className="text-xs text-a-text-3">Statut Stripe : {result.view.rawStatus}{result.view.charged ? ' · montant encaissé' : ' · aucun montant débité'}</p>
        </div>
      )}
    </section>
  );
}
