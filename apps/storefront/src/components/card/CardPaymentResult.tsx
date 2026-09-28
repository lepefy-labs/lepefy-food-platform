'use client';

import Link from 'next/link';
import { IconArrowRight, IconCircleCheck, IconClock, IconX } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { maskEmail, type CardPaymentOutcome, type CardPaymentReceipt } from '@/lib/card/cardPaymentOutcome';

type Lang = 'fr' | 'it';

const COPY = {
  fr: {
    succeeded: 'Paiement confirmé', processing: 'Paiement en cours de validation', failed: 'Paiement non abouti',
    at: (name: string) => `chez ${name}`, reference: 'Référence', confirmation: 'Email de confirmation',
    noEmail: 'Faites une capture de cet écran : elle vous sert de justificatif.',
    processingNote: 'Ne payez pas une seconde fois. Votre banque finalise l’opération ; le montant sera confirmé automatiquement.',
    failedNote: 'Aucun montant n’a été débité. Vous pouvez réessayer ou choisir un autre moyen de paiement.',
    shopTitle: 'Votre prochain panier ? Commandez en ligne, depuis votre téléphone.',
    shopCta: 'Commander en ligne', retry: 'Réessayer le paiement', returnCard: 'Retour à la carte',
  },
  it: {
    succeeded: 'Pagamento confermato', processing: 'Pagamento in corso di verifica', failed: 'Pagamento non riuscito',
    at: (name: string) => `presso ${name}`, reference: 'Riferimento', confirmation: 'Email di conferma',
    noEmail: 'Fai uno screenshot di questa schermata: ti serve come ricevuta.',
    processingNote: 'Non pagare una seconda volta. La tua banca sta completando l’operazione; l’importo verrà confermato automaticamente.',
    failedNote: 'Nessun importo è stato addebitato. Puoi riprovare o scegliere un altro metodo di pagamento.',
    shopTitle: 'Il tuo prossimo carrello? Ordina online, dal telefono.',
    shopCta: 'Ordina online', retry: 'Riprova il pagamento', returnCard: 'Torna alla card',
  },
} as const;

const TONE: Record<CardPaymentOutcome, { icon: typeof IconCircleCheck; bg: string; fg: string }> = {
  succeeded: { icon: IconCircleCheck, bg: '#ecfdf5', fg: '#047857' },
  processing: { icon: IconClock, bg: '#fffbeb', fg: '#b45309' },
  failed: { icon: IconX, bg: '#fef2f2', fg: '#b91c1c' },
};

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
  const secondary = 'min-h-12 w-full rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

  return (
    <div className="py-6 text-center" role="status" aria-live="polite">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: tone.bg, color: tone.fg }}>
        <Icon size={34} stroke={2} />
      </div>
      <h2 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-card-heading)' }}>{t[outcome]}</h2>
      {receipt.amount > 0 && <p className="mt-3 text-4xl font-extrabold text-gray-900">{formatPrice(receipt.amount, currency)}</p>}
      <p className="mt-1 text-sm text-gray-500">{t.at(tenantName)}</p>

      {outcome === 'succeeded' && (receipt.reference || email) && (
        <dl className="mt-5 divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-gray-50 px-4 text-left text-sm">
          {receipt.reference && <div className="flex items-center justify-between gap-3 py-3"><dt className="text-gray-500">{t.reference}</dt><dd className="font-mono font-bold text-gray-900">{receipt.reference}</dd></div>}
          {email && <div className="flex items-center justify-between gap-3 py-3"><dt className="text-gray-500">{t.confirmation}</dt><dd className="min-w-0 truncate text-gray-900">{email}</dd></div>}
        </dl>
      )}
      {outcome === 'succeeded' && !email && <p className="mt-4 text-sm text-gray-500">{t.noEmail}</p>}
      {outcome === 'processing' && <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">{t.processingNote}</p>}
      {outcome === 'failed' && <p className="mt-5 text-sm text-gray-600">{t.failedNote}</p>}

      <div className="mt-7 space-y-2.5">
        {outcome === 'succeeded' && shop && (
          <div className="border-t border-gray-100 pt-5">
            <p className="mb-3 text-sm font-medium text-gray-700">{t.shopTitle}</p>
            <Link href="/" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ backgroundColor: shop.color, color: shop.foreground, '--tw-ring-color': shop.color } as React.CSSProperties}>
              {t.shopCta} <IconArrowRight size={18} />
            </Link>
          </div>
        )}
        {outcome === 'failed' && onRetry && (
          <button type="button" onClick={onRetry} className="min-h-12 w-full rounded-xl bg-gray-900 px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2">{t.retry}</button>
        )}
        <button type="button" onClick={onReturnToCard} className={secondary}>{t.returnCard}</button>
      </div>
    </div>
  );
}
