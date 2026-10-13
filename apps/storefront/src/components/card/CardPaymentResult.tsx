'use client';

import Link from 'next/link';
import { IconArrowRight, IconCheck, IconCircleCheck, IconClock, IconX } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { maskEmail, type CardPaymentOutcome, type CardPaymentReceipt } from '@/lib/card/cardPaymentOutcome';

type Lang = 'fr' | 'it';

const COPY = {
  fr: {
    succeeded: 'Paiement confirmé', processing: 'Paiement en cours de validation', failed: 'Paiement non abouti',
    thanks: (name: string) => `Merci ! Votre paiement chez ${name} est bien reçu.`,
    at: (name: string) => `chez ${name}`, reference: 'Référence', confirmation: 'Confirmation envoyée à',
    noEmail: 'Faites une capture de cet écran : elle vous sert de justificatif.',
    processingNote: 'Ne payez pas une seconde fois. Votre banque finalise l’opération ; le montant sera confirmé automatiquement.',
    failedNote: 'Aucun montant n’a été débité. Vous pouvez réessayer ou choisir un autre moyen de paiement.',
    shopTitle: 'Envie d’autres produits ?', shopText: 'Commandez en ligne, depuis votre téléphone.',
    shopCta: 'Découvrir notre boutique', retry: 'Réessayer le paiement', returnCard: 'Retour à l’accueil',
  },
  it: {
    succeeded: 'Pagamento confermato', processing: 'Pagamento in corso di verifica', failed: 'Pagamento non riuscito',
    thanks: (name: string) => `Grazie! Il tuo pagamento presso ${name} è stato ricevuto.`,
    at: (name: string) => `presso ${name}`, reference: 'Riferimento', confirmation: 'Conferma inviata a',
    noEmail: 'Fai uno screenshot di questa schermata: ti serve come ricevuta.',
    processingNote: 'Non pagare una seconda volta. La tua banca sta completando l’operazione; l’importo verrà confermato automaticamente.',
    failedNote: 'Nessun importo è stato addebitato. Puoi riprovare o scegliere un altro metodo di pagamento.',
    shopTitle: 'Ti servono altri prodotti?', shopText: 'Ordina online, dal telefono.',
    shopCta: 'Scopri il nostro negozio', retry: 'Riprova il pagamento', returnCard: 'Torna alla pagina iniziale',
  },
} as const;

// Pastille pleine (icône blanche) : succès, attente, échec se distinguent par
// la forme de l'icône autant que par la couleur.
const TONE: Record<CardPaymentOutcome, { icon: typeof IconCircleCheck; badge: string }> = {
  succeeded: { icon: IconCheck, badge: '#047857' },
  processing: { icon: IconClock, badge: '#B45309' },
  failed: { icon: IconX, badge: '#B91C1C' },
};

const SURFACE = 'rounded-3xl bg-white shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04]';

export function CardPaymentResult({
  outcome, receipt, currency, lang, tenantName, shop, onReturnToCard, onRetry,
}: {
  outcome: CardPaymentOutcome;
  receipt: CardPaymentReceipt;
  currency: string;
  lang: Lang;
  tenantName: string;
  /** Online shop CTA, only when the storefront is open (tenants.storefront_ready). */
  shop: { color: string; foreground: string } | null;
  onReturnToCard: () => void;
  onRetry?: () => void;
}) {
  const t = COPY[lang];
  const tone = TONE[outcome];
  const Icon = tone.icon;
  const email = maskEmail(receipt.email);
  const secondary = 'min-h-[52px] w-full rounded-2xl bg-white px-4 text-base font-bold text-gray-900 ring-1 ring-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2';

  return (
    <div className="space-y-4">
      <div className={`${SURFACE} px-5 pb-6 pt-8 text-center`} role="status" aria-live="polite">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full text-white shadow-sm" style={{ backgroundColor: tone.badge }}>
          <Icon size={42} stroke={2.6} aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-[1.75rem] font-extrabold leading-tight text-gray-900" style={{ fontFamily: 'var(--font-card-heading)' }}>{t[outcome]}</h2>
        <p className="mt-1.5 text-base text-gray-700">{outcome === 'succeeded' ? t.thanks(tenantName) : t.at(tenantName)}</p>
        {receipt.amount > 0 && <p className="mt-4 text-5xl font-extrabold tracking-tight text-gray-950" style={{ fontFamily: 'var(--font-card-heading)' }}>{formatPrice(receipt.amount, currency)}</p>}

        {outcome === 'succeeded' && (receipt.reference || email) && (
          <dl className="mt-5 divide-y divide-gray-200 rounded-2xl bg-gray-50 px-4 text-left text-sm">
            {receipt.reference && <div className="flex items-center justify-between gap-3 py-3"><dt className="text-gray-700">{t.reference}</dt><dd className="font-mono font-bold text-gray-900">{receipt.reference}</dd></div>}
            {email && <div className="flex items-center justify-between gap-3 py-3"><dt className="text-gray-700">{t.confirmation}</dt><dd className="min-w-0 truncate font-medium text-gray-900">{email}</dd></div>}
          </dl>
        )}
        {outcome === 'succeeded' && !email && <p className="mt-4 text-sm text-gray-700">{t.noEmail}</p>}
        {outcome === 'processing' && <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">{t.processingNote}</p>}
        {outcome === 'failed' && <p className="mt-5 text-sm text-gray-700">{t.failedNote}</p>}
      </div>

      {outcome === 'succeeded' && shop && (
        <div className="rounded-3xl p-5" style={{ backgroundColor: shop.color, color: shop.foreground }}>
          <p className="text-lg font-extrabold" style={{ fontFamily: 'var(--font-card-heading)' }}>{t.shopTitle}</p>
          <p className="mb-4 mt-1 text-sm opacity-95">{t.shopText}</p>
          <Link href="/" className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-base font-extrabold text-gray-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60">
            {t.shopCta} <IconArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      )}
      {outcome === 'failed' && onRetry && (
        <button type="button" onClick={onRetry} className="min-h-[52px] w-full rounded-2xl bg-gray-900 px-4 text-base font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2">{t.retry}</button>
      )}
      <button type="button" onClick={onReturnToCard} className={secondary}>{t.returnCard}</button>
    </div>
  );
}
